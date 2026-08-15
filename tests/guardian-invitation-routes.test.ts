import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const requireSession = vi.fn();
  const sessionErrorResponse = vi.fn();
  const assertCan = vi.fn();
  const guardianFindMany = vi.fn();
  const guardianFindFirst = vi.fn();
  const accountFindMany = vi.fn();
  const accountCreate = vi.fn();
  const accountFindFirst = vi.fn();
  const accountUpdateMany = vi.fn();
  const activityCreate = vi.fn();
  const transaction = vi.fn();
  const sendEmail = vi.fn();
  const rateLimit = vi.fn();
  const tooManyRequests = vi.fn();
  const clientIp = vi.fn();
  const tx = {
    guardian: { findFirst: guardianFindFirst },
    guardianAccount: {
      create: accountCreate,
      findFirst: accountFindFirst,
      updateMany: accountUpdateMany,
    },
    activityLog: { create: activityCreate },
  };
  return {
    requireSession,
    sessionErrorResponse,
    assertCan,
    guardianFindMany,
    guardianFindFirst,
    accountFindMany,
    accountCreate,
    accountFindFirst,
    accountUpdateMany,
    activityCreate,
    transaction,
    sendEmail,
    rateLimit,
    tooManyRequests,
    clientIp,
    tx,
  };
});

vi.mock("@/lib/session", () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: mocks.sessionErrorResponse,
}));
vi.mock("@/lib/authz", () => ({ assertCan: mocks.assertCan }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guardian: { findMany: mocks.guardianFindMany },
    guardianAccount: { findMany: mocks.accountFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/notifications", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://app.example.test" },
}));
vi.mock("@/lib/invitations", () => ({
  mintInvite: () => ({
    token: "raw-guardian-invite-token",
    tokenHash: "hashed-guardian-invite-token",
    expiresAt: new Date("2026-08-18T12:00:00.000Z"),
  }),
  accountState: (account: { disabledAt: Date | null; acceptedAt: Date | null }) =>
    account.disabledAt ? "disabled" : account.acceptedAt ? "active" : "invited",
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.rateLimit,
  clientIp: mocks.clientIp,
}));

import { GET, POST as createGuardianAccount } from "@/app/api/guardian-accounts/route";
import { POST as resendGuardianInvite } from "@/app/api/guardian-accounts/[id]/invite/route";

const session = {
  user: {
    id: "manager-1",
    name: "Manager",
    email: "manager@example.test",
    schoolId: "school-1",
    schoolName: "School One",
    role: "admin",
  },
  permissions: ["students.guardians"],
  teacherId: null,
  can: vi.fn(() => true),
};

const eligibleGuardian = {
  id: "guardian-1",
  name: "Guardian One",
  email: "guardian@example.test",
  phone1: "+966500000000",
  school: { name: "School One", email: "school@example.test" },
  students: [{ id: "student-1" }],
  links: [],
};

const pendingAccount = {
  id: "account-1",
  schoolId: "school-1",
  guardianId: "guardian-1",
  email: "guardian@example.test",
  passwordHash: null,
  acceptedAt: null,
  disabledAt: null,
  inviteTokenHash: "old-invite-hash",
  inviteExpiresAt: new Date("2026-08-10T12:00:00.000Z"),
  school: { name: "School One", email: "school@example.test" },
  guardian: {
    name: "Guardian One",
    deletedAt: null,
    anonymizedAt: null,
    students: [{ id: "student-1" }],
    links: [],
  },
};

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/guardian-accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
}

function resendRequest(id = "account-1") {
  return {
    request: new Request(`http://localhost/api/guardian-accounts/${id}/invite`, {
      method: "POST",
    }),
    context: { params: Promise.resolve({ id }) },
  };
}

beforeEach(() => {
  for (const value of Object.values(mocks)) {
    if (typeof value === "function" && "mockReset" in value) value.mockReset();
  }
  session.can.mockClear();
  mocks.requireSession.mockResolvedValue(session);
  mocks.sessionErrorResponse.mockReturnValue(null);
  mocks.clientIp.mockReturnValue("127.0.0.1");
  mocks.rateLimit.mockResolvedValue({ status: "allowed", remaining: 4, retryAfter: 0 });
  mocks.tooManyRequests.mockImplementation((retryAfter: number) =>
    Response.json({ error: "Too many" }, { status: 429, headers: { "Retry-After": String(retryAfter) } })
  );
  mocks.guardianFindMany.mockResolvedValue([]);
  mocks.accountFindMany.mockResolvedValue([]);
  mocks.guardianFindFirst.mockResolvedValue(eligibleGuardian);
  mocks.accountCreate.mockResolvedValue({
    id: "account-1",
    email: "guardian@example.test",
    phone: "+966500000000",
  });
  mocks.accountFindFirst.mockResolvedValue(pendingAccount);
  mocks.accountUpdateMany.mockResolvedValue({ count: 1 });
  mocks.activityCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(
    async (operation: (tx: typeof mocks.tx) => Promise<unknown>) => operation(mocks.tx)
  );
  mocks.sendEmail.mockResolvedValue({ success: true, status: "sent" });
});

describe("guardian account tenant and permission guards", () => {
  it("checks students.guardians defensively and scopes both list queries", async () => {
    mocks.guardianFindMany.mockResolvedValueOnce([
      {
        id: "guardian-1",
        name: "Guardian One",
        email: "guardian@example.test",
        phone1: null,
        students: [],
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.assertCan).toHaveBeenCalledWith(session, "students.guardians");
    expect(mocks.guardianFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: "school-1", deletedAt: null, anonymizedAt: null },
      })
    );
    expect(mocks.accountFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: "school-1", guardianId: { in: ["guardian-1"] } },
      })
    );
  });

  it("fails closed before database access without the permission", async () => {
    mocks.assertCan.mockImplementationOnce(() => {
      throw new Error("forbidden");
    });
    mocks.sessionErrorResponse.mockReturnValueOnce(
      Response.json({ error: "Forbidden" }, { status: 403 })
    );

    const response = await createGuardianAccount(createRequest({ guardianId: "guardian-1" }));
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("guardian account creation", () => {
  it("creates the pending account and audit row atomically without exposing secrets", async () => {
    const response = await createGuardianAccount(createRequest({ guardianId: "guardian-1" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.guardianFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "guardian-1",
          schoolId: "school-1",
          deletedAt: null,
          anonymizedAt: null,
        }),
      })
    );
    expect(mocks.accountCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schoolId: "school-1",
          guardianId: "guardian-1",
          passwordHash: null,
          acceptedAt: null,
          inviteTokenHash: "hashed-guardian-invite-token",
        }),
      })
    );
    expect(mocks.activityCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      "guardian@example.test",
      expect.any(String),
      expect.stringContaining("/activate/raw-guardian-invite-token"),
      "School One",
      {
        sender: {
          kind: "school",
          displayName: "School One",
          replyTo: "school@example.test",
        },
        language: "ar",
      }
    );
    expect(body).toMatchObject({ invitationSent: true, deliveryStatus: "sent" });
    expect(JSON.stringify(body)).not.toMatch(/token|hash|password/i);
  });

  it.each([
    ["missing guardian", null],
    ["deleted or anonymized guardian", null],
    ["guardian without active children", { ...eligibleGuardian, students: [], links: [] }],
  ])("rejects an ineligible %s", async (_label, guardian) => {
    mocks.guardianFindFirst.mockResolvedValueOnce(guardian);
    const response = await createGuardianAccount(createRequest({ guardianId: "guardian-1" }));
    expect(response.status).toBe(409);
    expect(mocks.accountCreate).not.toHaveBeenCalled();
  });

  it("accepts an active child through the secondary guardian link", async () => {
    mocks.guardianFindFirst.mockResolvedValueOnce({
      ...eligibleGuardian,
      students: [],
      links: [{ studentId: "student-2" }],
    });
    const response = await createGuardianAccount(createRequest({ guardianId: "guardian-1" }));
    expect(response.status).toBe(201);
  });

  it("rejects a missing or invalid stored email", async () => {
    mocks.guardianFindFirst.mockResolvedValueOnce({ ...eligibleGuardian, email: "not-an-email" });
    const response = await createGuardianAccount(createRequest({ guardianId: "guardian-1" }));
    expect(response.status).toBe(422);
    expect(mocks.accountCreate).not.toHaveBeenCalled();
  });

  it("keeps the account and returns 207 when invitation delivery fails", async () => {
    mocks.sendEmail.mockResolvedValueOnce({
      success: false,
      status: "failed",
      error: "provider secret detail",
    });
    const response = await createGuardianAccount(createRequest({ guardianId: "guardian-1" }));
    const body = await response.json();
    expect(response.status).toBe(207);
    expect(body).toMatchObject({ invitationSent: false, deliveryStatus: "failed" });
    expect(JSON.stringify(body)).not.toContain("provider secret detail");
  });

  it("returns a generic 409 for a concurrent unique collision", async () => {
    mocks.accountCreate.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    const response = await createGuardianAccount(createRequest({ guardianId: "guardian-1" }));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("guardian@example.test");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("rolls back and does not send when the atomic audit write fails", async () => {
    mocks.activityCreate.mockRejectedValueOnce(new Error("audit failed"));
    await expect(
      createGuardianAccount(createRequest({ guardianId: "guardian-1" }))
    ).rejects.toThrow("audit failed");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("rate-limits creation before opening a transaction", async () => {
    mocks.rateLimit.mockResolvedValueOnce({ status: "limited", remaining: 0, retryAfter: 60 });
    const response = await createGuardianAccount(createRequest({ guardianId: "guardian-1" }));
    expect(response.status).toBe(429);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("guardian invitation rotation", () => {
  it("rotates an expired pending invitation with a CAS and no secret response", async () => {
    const { request, context } = resendRequest();
    const response = await resendGuardianInvite(request, context);
    const body = await response.json();

    expect(mocks.accountUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "account-1",
        schoolId: "school-1",
        guardianId: "guardian-1",
        passwordHash: null,
        acceptedAt: null,
        disabledAt: null,
        inviteTokenHash: "old-invite-hash",
        inviteExpiresAt: new Date("2026-08-10T12:00:00.000Z"),
      },
      data: {
        inviteTokenHash: "hashed-guardian-invite-token",
        inviteExpiresAt: new Date("2026-08-18T12:00:00.000Z"),
      },
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({ sent: true, deliveryStatus: "sent" });
    expect(JSON.stringify(body)).not.toMatch(/token|hash|password/i);
  });

  it.each([
    ["active", { ...pendingAccount, acceptedAt: new Date(), passwordHash: "hash" }, 409],
    ["disabled", { ...pendingAccount, disabledAt: new Date() }, 409],
  ])("blocks an %s account", async (_label, account, status) => {
    mocks.accountFindFirst.mockResolvedValueOnce(account);
    const { request, context } = resendRequest();
    const response = await resendGuardianInvite(request, context);
    expect(response.status).toBe(status);
    expect(mocks.accountUpdateMany).not.toHaveBeenCalled();
  });

  it("directs an active account to password recovery without rotating it", async () => {
    mocks.accountFindFirst.mockResolvedValueOnce({
      ...pendingAccount,
      acceptedAt: new Date(),
      passwordHash: "hash",
    });
    const { request, context } = resendRequest();
    const response = await resendGuardianInvite(request, context);
    expect(await response.json()).toMatchObject({ action: "password_reset" });
    expect(mocks.accountUpdateMany).not.toHaveBeenCalled();
  });

  it("does not reveal or update an account from another tenant", async () => {
    mocks.accountFindFirst.mockResolvedValueOnce(null);
    const { request, context } = resendRequest("other-tenant-account");
    const response = await resendGuardianInvite(request, context);
    expect(response.status).toBe(404);
    expect(mocks.accountFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "other-tenant-account", schoolId: "school-1" } })
    );
    expect(mocks.accountUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 207 while retaining the rotated invitation after email failure", async () => {
    mocks.sendEmail.mockResolvedValueOnce({
      success: false,
      status: "failed",
      error: "provider down",
    });
    const { request, context } = resendRequest();
    const response = await resendGuardianInvite(request, context);
    expect(response.status).toBe(207);
    expect(mocks.accountUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("lets only one concurrent resend claim the previous invitation state", async () => {
    let claims = 0;
    mocks.accountUpdateMany.mockImplementation(async () => ({ count: ++claims === 1 ? 1 : 0 }));
    const first = resendRequest();
    const second = resendRequest();
    const responses = await Promise.all([
      resendGuardianInvite(first.request, first.context),
      resendGuardianInvite(second.request, second.context),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });
});
