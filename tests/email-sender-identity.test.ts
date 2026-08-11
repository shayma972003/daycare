import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provider: "resend" as "resend" | "smtp" | "none",
  enabled: true,
  fetch: vi.fn(),
  sendMail: vi.fn(),
  createTransport: vi.fn(),
  notificationCreate: vi.fn(),
  env: {
    FROM_EMAIL: "mailer@platform.example",
    RESEND_API_KEY: "test-resend-key-not-a-secret",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: 587,
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "test-password-not-a-secret",
  },
}));

vi.mock("@/lib/env", () => ({
  env: mocks.env,
  get emailEnabled() {
    return mocks.enabled;
  },
  get emailProvider() {
    return mocks.provider;
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { notificationLog: { create: mocks.notificationCreate } },
}));

vi.mock("nodemailer", () => ({
  createTransport: mocks.createTransport,
}));

import { sendEmail } from "@/lib/notifications";
import { PLATFORM_BRAND } from "@/lib/branding";

function resendPayload(): Record<string, unknown> {
  const request = mocks.fetch.mock.calls.at(-1)?.[1] as RequestInit;
  return JSON.parse(String(request.body)) as Record<string, unknown>;
}

beforeEach(() => {
  mocks.provider = "resend";
  mocks.enabled = true;
  mocks.fetch.mockReset();
  mocks.sendMail.mockReset();
  mocks.createTransport.mockReset();
  mocks.notificationCreate.mockReset();
  mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
  mocks.sendMail.mockResolvedValue({ messageId: "test-message" });
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("central email sender identity", () => {
  it("keeps FROM_EMAIL central and applies the Arabic school identity and Resend reply_to", async () => {
    await expect(
      sendEmail("guardian@example.test", "Subject", "Body", "روضة الأمل", {
        sender: {
          kind: "school",
          displayName: "روضة الأمل",
          replyTo: "school@example.test",
        },
        language: "ar",
      })
    ).resolves.toEqual({ success: true });

    const payload = resendPayload();
    expect(payload.from).toBe(
      `"روضة الأمل عبر ${PLATFORM_BRAND.ar}" <mailer@platform.example>`
    );
    expect(payload.from).not.toContain("school@example.test");
    expect(payload.reply_to).toBe("school@example.test");
  });

  it("builds the English identity from the same central brand configuration", async () => {
    await sendEmail("guardian@example.test", "Subject", "Body", "School name", {
      sender: {
        kind: "school",
        displayName: "School name",
        replyTo: "school@example.test",
      },
      language: "en",
    });

    const payload = resendPayload();
    expect(payload.from).toBe(
      `"School name via ${PLATFORM_BRAND.en}" <mailer@platform.example>`
    );
    expect(payload.html).toContain('<html dir="ltr" lang="en">');
  });

  it("removes CRLF from display headers and rejects an injected Reply-To", async () => {
    await sendEmail("guardian@example.test", "Subject\r\nBcc: attacker@example.test", "Body", "School", {
      sender: {
        kind: "school",
        displayName: "School\r\nBcc: attacker@example.test",
        replyTo: "school@example.test\r\nBcc: attacker@example.test",
      },
    });

    const payload = resendPayload();
    expect(payload.from).not.toMatch(/[\r\n]/);
    expect(payload.subject).not.toMatch(/[\r\n]/);
    expect(payload).not.toHaveProperty("reply_to");
  });

  it.each([undefined, null, "not-an-email"])(
    "omits an absent or invalid Reply-To (%s)",
    async (replyTo) => {
      await sendEmail("guardian@example.test", "Subject", "Body", "School", {
        sender: { kind: "school", displayName: "School", replyTo },
      });
      expect(resendPayload()).not.toHaveProperty("reply_to");
    }
  );

  it("uses Nodemailer's replyTo field with the same central From address", async () => {
    mocks.provider = "smtp";

    await sendEmail("teacher@example.test", "Subject", "Body", "School name", {
      sender: {
        kind: "school",
        displayName: "School name",
        replyTo: "school@example.test",
      },
      language: "en",
    });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: `"School name via ${PLATFORM_BRAND.en}" <mailer@platform.example>`,
        replyTo: "school@example.test",
      })
    );
  });

  it("keeps system mail central and never adds a school Reply-To", async () => {
    await sendEmail("owner@example.test", "Security code", "123456", "School name");

    const payload = resendPayload();
    expect(payload.from).toBe(`"${PLATFORM_BRAND.ar}" <mailer@platform.example>`);
    expect(payload).not.toHaveProperty("reply_to");
  });

  it("returns a generic provider failure without exposing provider details", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response("secret-provider-diagnostic", { status: 503 })
    );

    const result = await sendEmail("owner@example.test", "Subject", "Body", "School");

    expect(result).toEqual({ success: false, error: "Email delivery failed" });
    expect(JSON.stringify(result)).not.toContain("secret-provider-diagnostic");
    expect(JSON.stringify(result)).not.toContain(mocks.env.RESEND_API_KEY);
  });
});

describe("email call-site classification", () => {
  it("marks school-behalf flows and leaves security/admin activation flows central", () => {
    const schoolDirect = [
      "src/app/api/staff-accounts/route.ts",
      "src/app/api/staff-accounts/[id]/invite/route.ts",
      "src/app/api/guardian-accounts/route.ts",
      "src/app/api/guardian-accounts/[id]/invite/route.ts",
      "src/app/api/enrollment/create-token/route.ts",
      "src/app/api/enrollment/resend-otp/route.ts",
      "src/lib/care-report-digest.ts",
    ];
    const schoolNotifications = [
      "src/app/api/reminders/route.ts",
      "src/app/api/activities/[id]/send/route.ts",
      "src/app/api/students/[id]/reminder/route.ts",
      "src/app/api/teachers/[id]/reminder/route.ts",
    ];
    const platformOnly = [
      "src/lib/auth.ts",
      "src/app/api/auth/forgot-password/route.ts",
      "src/app/api/auth/resend-2fa-otp/route.ts",
      "src/app/api/settings/2fa/send-activation-otp/route.ts",
      "src/app/api/admin/schools/route.ts",
      "src/app/api/admin/schools/[id]/invite/route.ts",
    ];

    for (const path of schoolDirect) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source, path).toContain('kind: "school"');
      expect(source, path).toContain("replyTo:");
    }
    for (const path of schoolNotifications) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source, path).toMatch(/sendNotification\([\s\S]*school\?\.email/);
    }
    for (const path of platformOnly) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source, path).not.toContain('kind: "school"');
      expect(source, path).not.toContain("replyTo:");
    }
  });
});
