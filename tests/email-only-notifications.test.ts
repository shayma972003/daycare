import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notificationCreate: vi.fn(),
  twoFaFindFirst: vi.fn(),
  twoFaCreate: vi.fn(),
  twoFaDeleteMany: vi.fn(),
  enrollmentTokenFindUnique: vi.fn(),
  enrollmentTokenUpdate: vi.fn(),
  enrollmentSubmissionCreate: vi.fn(),
  enrollmentReservation: vi.fn(),
  transaction: vi.fn(),
  requireSession: vi.fn(),
  rateLimit: vi.fn(),
  fetch: vi.fn(),
  bcryptHash: vi.fn(),
}));

const emailConfig = vi.hoisted(() => ({ deliveryEnabled: true }));

vi.mock("@/lib/env", () => ({
  env: {
    FROM_EMAIL: "no-reply@example.com",
    RESEND_API_KEY: "test-resend-key",
    APP_URL: "http://localhost:3000",
  },
  emailEnabled: true,
  emailProvider: "resend",
  get emailDeliveryEnabled() {
    return emailConfig.deliveryEnabled;
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    notificationLog: { create: mocks.notificationCreate },
    twoFASession: {
      findFirst: mocks.twoFaFindFirst,
      create: mocks.twoFaCreate,
      deleteMany: mocks.twoFaDeleteMany,
    },
    enrollmentToken: {
      findUnique: mocks.enrollmentTokenFindUnique,
      update: mocks.enrollmentTokenUpdate,
    },
    enrollmentSubmission: { create: mocks.enrollmentSubmissionCreate },
  },
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: () => null,
}));

vi.mock("bcryptjs", () => ({
  default: { hash: mocks.bcryptHash },
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.rateLimit,
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/r2", () => ({
  keyFromUrl: () => null,
  schoolIdFromKey: () => null,
}));

import { sendNotification } from "@/lib/notifications";
import { POST as sendActivationOtp } from "@/app/api/settings/2fa/send-activation-otp/route";
import { POST as submitEnrollment } from "@/app/api/enrollment/submit/route";

beforeEach(() => {
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.PII_INDEX_PEPPER = randomBytes(48).toString("base64");
  emailConfig.deliveryEnabled = true;
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({
      $queryRaw: mocks.enrollmentReservation,
      enrollmentSubmission: { create: mocks.enrollmentSubmissionCreate },
    })
  );
  mocks.enrollmentReservation.mockResolvedValue([{ submissions_count: 1, max_submissions: 4 }]);

  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
  mocks.notificationCreate.mockResolvedValue({ id: "notification-1" });
  mocks.twoFaFindFirst.mockResolvedValue(null);
  mocks.twoFaCreate.mockResolvedValue({ id: "2fa-session-1" });
  mocks.twoFaDeleteMany.mockResolvedValue({ count: 1 });
  mocks.bcryptHash.mockResolvedValue("otp-hash");
  mocks.rateLimit.mockResolvedValue({ status: "allowed", remaining: 10, retryAfter: 0 });
  mocks.requireSession.mockResolvedValue({
    user: {
      id: "user-1",
      email: "owner@example.com",
      name: "Owner",
      schoolId: "school-1",
      schoolName: "Test School",
      role: "admin",
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("email-only notification delivery", () => {
  it("has no operational Twilio sender or WhatsApp environment switch", () => {
    const notificationSource = readFileSync(
      resolve(process.cwd(), "src/lib/notifications.ts"),
      "utf8"
    );
    const envSource = readFileSync(resolve(process.cwd(), "src/lib/env.ts"), "utf8");
    const example = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

    expect(notificationSource).not.toMatch(/sendWhatsApp|api\.twilio\.com|TWILIO_/);
    expect(envSource).not.toMatch(/ENABLE_WHATSAPP|TWILIO_|whatsappEnabled/);
    expect(example).not.toMatch(/ENABLE_WHATSAPP|TWILIO_/);
  });

  it("returns sent and records an EMAIL/SENT row only after provider success", async () => {
    const result = await sendNotification(
      "school-1",
      "Guardian",
      "guardian@example.com",
      "Hello <child_name>",
      { child_name: "Maha" },
      "Test School",
      "reminder",
      { studentId: "student-1" },
      "school@example.com"
    );

    expect(result).toEqual({ status: "sent" });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    const requestBody = JSON.parse(
      String((mocks.fetch.mock.calls[0][1] as RequestInit).body)
    );
    expect(requestBody.to).toBe("guardian@example.com");
    expect(requestBody.from).toContain("no-reply@example.com");
    expect(requestBody.reply_to).toBe("school@example.com");
    expect(mocks.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "EMAIL",
        status: "SENT",
        studentId: "student-1",
      }),
    });
  });

  it("returns failed and never counts a provider failure as SENT", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("provider unavailable", { status: 503 }));

    const result = await sendNotification(
      "school-1",
      "Guardian",
      "guardian@example.com",
      "Message",
      {},
      "Test School"
    );

    expect(result).toEqual({ status: "failed", reason: "email_delivery" });
    expect(mocks.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "EMAIL", status: "FAILED" }),
    });
    expect(mocks.notificationCreate).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "SENT" }),
    });
  });

  it("returns no_email without contacting a provider or creating a log", async () => {
    await expect(
      sendNotification("school-1", "Guardian", null, "Message", {}, "Test School")
    ).resolves.toEqual({ status: "no_email" });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("returns disabled without contacting a provider or recording a SENT row", async () => {
    emailConfig.deliveryEnabled = false;

    await expect(
      sendNotification(
        "school-1",
        "Guardian",
        "guardian@example.com",
        "Message",
        {},
        "Test School"
      )
    ).resolves.toEqual({ status: "disabled" });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });
});

describe("email 2FA activation", () => {
  it("sends the activation OTP to the signed-in user's registered email", async () => {
    const response = await sendActivationOtp();

    expect(response.status).toBe(200);
    const requestBody = JSON.parse(
      String((mocks.fetch.mock.calls[0][1] as RequestInit).body)
    );
    expect(requestBody.to).toBe("owner@example.com");
    expect(requestBody).not.toHaveProperty("reply_to");
    expect(mocks.twoFaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schoolId: "school-1",
        userId: "user-1",
        purpose: "ACTIVATE",
      }),
    });
    expect(mocks.twoFaDeleteMany).not.toHaveBeenCalled();

    const activationSource = readFileSync(
      resolve(process.cwd(), "src/app/api/settings/2fa/activate/route.ts"),
      "utf8"
    );
    expect(activationSource).not.toMatch(/phoneNumber|twoFaPhone/);

    const settingsSource = readFileSync(
      resolve(process.cwd(), "src/app/(dashboard)/settings/page.tsx"),
      "utf8"
    );
    expect(settingsSource).not.toMatch(/twoFa\.needPhone|\+966\$\{phoneNumber\}/);
  });

  it("returns a clear failure and removes the OTP session when email fails", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("provider unavailable", { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await sendActivationOtp();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("تعذر إرسال"),
    });
    expect(mocks.twoFaDeleteMany).toHaveBeenCalledWith({
      where: { id: "2fa-session-1", schoolId: "school-1", purpose: "ACTIVATE" },
    });
  });
});

describe("enrollment submission logging", () => {
  it("does not create a fake WhatsApp or email delivery log for a new submission", async () => {
    mocks.enrollmentTokenFindUnique.mockResolvedValue({
      id: "token-row-1",
      token: "live-token",
      school_id: "school-1",
      otp_verified: true,
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 3,
    });
    mocks.enrollmentSubmissionCreate.mockResolvedValue({ id: "submission-1" });
    mocks.enrollmentTokenUpdate.mockResolvedValue({});

    const response = await submitEnrollment(
      new Request("http://localhost/api/enrollment/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "live-token",
          full_name: "Child One",
          id_number: "1098765432",
          nationality: "سعودي",
          gender: "ذكر",
          period: "صباحي",
          date_of_birth: "2022-01-10",
          health_condition: "لا يوجد",
          allergies: "لا يوجد",
          guardian_name: "Guardian One",
          guardian_phone_1: "0500000001",
          guardian_phone_2: "0500000002",
          guardian_email: "guardian@example.com",
          guardian_name_2: "Guardian Two",
          guardian_email_2: "",
          enrollment_date: "2026-09-09",
          payment_method: "نقدي",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.enrollmentSubmissionCreate).toHaveBeenCalledOnce();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });
});
