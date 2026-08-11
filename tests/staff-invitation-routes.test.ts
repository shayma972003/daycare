import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const requireSession = vi.fn();
  const sessionErrorResponse = vi.fn();
  const assertCan = vi.fn();
  const roleFindFirst = vi.fn();
  const teacherFindFirst = vi.fn();
  const schoolFindUnique = vi.fn();
  const userCreate = vi.fn();
  const userFindFirst = vi.fn();
  const userUpdateMany = vi.fn();
  const activityCreate = vi.fn();
  const transaction = vi.fn();
  const sendEmail = vi.fn();
  const rateLimit = vi.fn();
  const tooManyRequests = vi.fn();
  const logAction = vi.fn();

  const tx = {
    user: {
      create: userCreate,
      findFirst: userFindFirst,
      updateMany: userUpdateMany,
    },
    activityLog: { create: activityCreate },
  };

  return {
    requireSession,
    sessionErrorResponse,
    assertCan,
    roleFindFirst,
    teacherFindFirst,
    schoolFindUnique,
    userCreate,
    userFindFirst,
    userUpdateMany,
    activityCreate,
    transaction,
    sendEmail,
    rateLimit,
    tooManyRequests,
    logAction,
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
    role: { findFirst: mocks.roleFindFirst },
    teacher: { findFirst: mocks.teacherFindFirst },
    school: { findUnique: mocks.schoolFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/notifications", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://app.example.test" },
}));
vi.mock("@/lib/invitations", () => ({
  mintInvite: () => ({
    token: "raw-staff-invite-token",
    tokenHash: "hashed-staff-invite-token",
    expiresAt: new Date("2026-08-18T12:00:00.000Z"),
  }),
  accountState: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  tooManyRequests: mocks.tooManyRequests,
}));
vi.mock("@/lib/activity-logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/activity-logger")>();
  return { ...actual, logAction: mocks.logAction };
});

import { POST as createStaff } from "@/app/api/staff-accounts/route";
import { PUT as updateStaff } from "@/app/api/staff-accounts/[id]/route";
import { POST as resendStaffInvite } from "@/app/api/staff-accounts/[id]/invite/route";

const session = {
  user: {
    id: "manager-1",
    name: "Manager",
    email: "manager@example.test",
    schoolId: "school-1",
    schoolName: "School One",
    role: "admin",
  },
  permissions: ["staff.manage"],
  teacherId: null,
  can: vi.fn(() => true),
};

const pendingTarget = {
  id: "staff-1",
  name: "Staff One",
  email: "staff@example.test",
  password: null,
  acceptedAt: null,
  disabledAt: null,
  roleId: "role-1",
  roleRef: { nameAr: "موظف", permissions: ["students.view"] },
  school: { name: "School One" },
};

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/staff-accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resendRequest(id = "staff-1") {
  return {
    request: new Request(`http://localhost/api/staff-accounts/${id}/invite`, {
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
  mocks.roleFindFirst.mockResolvedValue({
    id: "role-1",
    nameAr: "موظف",
    permissions: ["students.view"],
  });
  mocks.teacherFindFirst.mockResolvedValue({ id: "teacher-1" });
  mocks.schoolFindUnique.mockResolvedValue({ name: "School One" });
  mocks.userCreate.mockResolvedValue({
    id: "staff-1",
    name: "Staff One",
    email: "staff@example.test",
  });
  mocks.userFindFirst.mockImplementation(async (args) =>
    args.orderBy ? { id: "owner-1" } : pendingTarget
  );
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.activityCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(
    async (operation: (tx: typeof mocks.tx) => Promise<unknown>) => operation(mocks.tx)
  );
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.rateLimit.mockResolvedValue({ ok: true, remaining: 4, retryAfter: 0 });
  mocks.tooManyRequests.mockImplementation((retryAfter: number) =>
    Response.json({ error: "Too many" }, { status: 429, headers: { "Retry-After": String(retryAfter) } })
  );
});

describe("staff account creation by invitation", () => {
  it("creates only a pending account, hashed invitation, and audit row in one transaction", async () => {
    const response = await createStaff(
      createRequest({
        name: "Staff One",
        email: "STAFF@EXAMPLE.TEST",
        roleId: "role-1",
      })
    );
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.assertCan).toHaveBeenCalledWith(session, "staff.manage");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "staff@example.test",
          password: null,
          acceptedAt: null,
          inviteTokenHash: "hashed-staff-invite-token",
        }),
      })
    );
    expect(mocks.activityCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      "staff@example.test",
      expect.any(String),
      expect.stringContaining("/activate/raw-staff-invite-token"),
      "School One"
    );
    expect(result).toEqual({
      id: "staff-1",
      name: "Staff One",
      email: "staff@example.test",
      invitationSent: true,
      deliveryStatus: "sent",
    });
    expect(JSON.stringify(result)).not.toMatch(/token|hash|password/i);
  });

  it("rejects a direct password field instead of silently activating the account", async () => {
    const response = await createStaff(
      createRequest({
        name: "Staff One",
        email: "staff@example.test",
        roleId: "role-1",
        password: "Direct-password-1!",
      })
    );

    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("also rejects password changes through the staff update API", async () => {
    const response = await updateStaff(
      new Request("http://localhost/api/staff-accounts/staff-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "Direct-password-1!" }),
      }),
      { params: Promise.resolve({ id: "staff-1" }) }
    );

    expect(response.status).toBe(422);
    expect(mocks.assertCan).toHaveBeenCalledWith(session, "staff.manage");
  });

  it("keeps the account and returns 207 when email delivery fails", async () => {
    mocks.sendEmail.mockResolvedValueOnce({ success: false, error: "provider unavailable" });
    const response = await createStaff(
      createRequest({ name: "Staff One", email: "staff@example.test", roleId: "role-1" })
    );
    const result = await response.json();

    expect(response.status).toBe(207);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ invitationSent: false, deliveryStatus: "failed" });
    expect(JSON.stringify(result)).not.toContain("provider unavailable");
  });

  it("does not deliver an invitation when the atomic audit write fails", async () => {
    mocks.activityCreate.mockRejectedValueOnce(new Error("audit write failed"));

    await expect(
      createStaff(
        createRequest({ name: "Staff One", email: "staff@example.test", roleId: "role-1" })
      )
    ).rejects.toThrow("audit write failed");

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("turns a concurrent duplicate-email unique violation into 409", async () => {
    let attempt = 0;
    mocks.userCreate.mockImplementation(async () => {
      attempt += 1;
      if (attempt === 2) {
        throw Object.assign(new Error("unique"), {
          code: "P2002",
          meta: {
            modelName: "User",
            driverAdapterError: {
              cause: {
                kind: "UniqueConstraintViolation",
                constraint: { fields: ["email"] },
              },
            },
          },
        });
      }
      return { id: "staff-1", name: "Staff One", email: "staff@example.test" };
    });

    const responses = await Promise.all([
      createStaff(createRequest({ name: "Staff One", email: "staff@example.test", roleId: "role-1" })),
      createStaff(createRequest({ name: "Staff Two", email: "staff@example.test", roleId: "role-1" })),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the caller lacks staff.manage", async () => {
    mocks.assertCan.mockImplementationOnce(() => {
      throw new Error("forbidden");
    });
    mocks.sessionErrorResponse.mockReturnValueOnce(
      Response.json({ error: "Forbidden" }, { status: 403 })
    );

    const response = await createStaff(
      createRequest({ name: "Staff One", email: "staff@example.test", roleId: "role-1" })
    );
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("staff invitation rotation", () => {
  it("rate-limits resends and rotates the stored hash without returning the token", async () => {
    const { request, context } = resendRequest();
    const response = await resendStaffInvite(request, context);
    const result = await response.json();

    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: "staff-invite:school-1:staff-1",
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "staff-1",
        schoolId: "school-1",
        password: null,
        acceptedAt: null,
        disabledAt: null,
        roleId: "role-1",
        NOT: {
          roleRef: { is: { permissions: { has: "*" } } },
        },
      },
      data: {
        inviteTokenHash: "hashed-staff-invite-token",
        inviteExpiresAt: new Date("2026-08-18T12:00:00.000Z"),
      },
    });
    expect(response.status).toBe(200);
    expect(result).toEqual({ sent: true, deliveryStatus: "sent" });
    expect(JSON.stringify(result)).not.toMatch(/token|hash|password/i);
  });

  it("returns 207 and keeps the rotated invitation when resend delivery fails", async () => {
    mocks.sendEmail.mockResolvedValueOnce({ success: false, error: "provider unavailable" });
    const { request, context } = resendRequest();
    const response = await resendStaffInvite(request, context);

    expect(response.status).toBe(207);
    expect(mocks.userUpdateMany).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ sent: false, deliveryStatus: "failed" });
  });

  it.each([
    ["active", { ...pendingTarget, acceptedAt: new Date() }, 409],
    ["disabled", { ...pendingTarget, disabledAt: new Date() }, 409],
    ["wildcard", { ...pendingTarget, roleRef: { nameAr: "مالك", permissions: ["*"] } }, 403],
  ])("blocks an %s account", async (_label, target, status) => {
    mocks.userFindFirst.mockImplementation(async (args) =>
      args.orderBy ? { id: "owner-1" } : target
    );
    const { request, context } = resendRequest();
    const response = await resendStaffInvite(request, context);
    expect(response.status).toBe(status);
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("blocks the legacy first account even without a wildcard role", async () => {
    mocks.userFindFirst.mockImplementation(async (args) =>
      args.orderBy ? { id: "staff-1" } : pendingTarget
    );
    const { request, context } = resendRequest();
    const response = await resendStaffInvite(request, context);
    expect(response.status).toBe(403);
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("does not reveal or update a user from another tenant", async () => {
    mocks.userFindFirst.mockResolvedValueOnce(null);
    const { request, context } = resendRequest("other-tenant-user");
    const response = await resendStaffInvite(request, context);
    expect(response.status).toBe(404);
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("does not read the account after the rate limit is exceeded", async () => {
    mocks.rateLimit.mockResolvedValueOnce({ ok: false, remaining: 0, retryAfter: 60 });
    const { request, context } = resendRequest();
    const response = await resendStaffInvite(request, context);
    expect(response.status).toBe(429);
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });
});
