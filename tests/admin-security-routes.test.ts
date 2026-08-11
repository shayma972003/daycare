import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashInviteToken } from "@/lib/invitations";

const mocks = vi.hoisted(() => {
  const superAdminFindUnique = vi.fn();
  const schoolFindMany = vi.fn();
  const schoolFindUnique = vi.fn();
  const userFindUnique = vi.fn();
  const userFindFirst = vi.fn();
  const schoolCreate = vi.fn();
  const userCreate = vi.fn();
  const schoolAdminInvitationCreate = vi.fn();
  const schoolAdminInvitationUpdateMany = vi.fn();
  const adminActivityCreate = vi.fn();
  const superAdminUpdateMany = vi.fn();
  const transaction = vi.fn();
  const bcryptCompare = vi.fn();
  const bcryptHash = vi.fn();
  const sendEmail = vi.fn();
  const rateLimit = vi.fn();
  const resetRateLimit = vi.fn();
  const clientIp = vi.fn();
  const tooManyRequests = vi.fn();

  const tx = {
    user: {
      findUnique: userFindUnique,
      findFirst: userFindFirst,
      create: userCreate,
    },
    school: { findUnique: schoolFindUnique, create: schoolCreate },
    schoolAdminInvitation: {
      create: schoolAdminInvitationCreate,
      updateMany: schoolAdminInvitationUpdateMany,
    },
    adminActivityLog: { create: adminActivityCreate },
    superAdmin: { updateMany: superAdminUpdateMany },
  };

  return {
    superAdminFindUnique,
    schoolFindMany,
    schoolFindUnique,
    userFindUnique,
    userFindFirst,
    schoolCreate,
    userCreate,
    schoolAdminInvitationCreate,
    schoolAdminInvitationUpdateMany,
    adminActivityCreate,
    superAdminUpdateMany,
    transaction,
    bcryptCompare,
    bcryptHash,
    sendEmail,
    rateLimit,
    resetRateLimit,
    clientIp,
    tooManyRequests,
    tx,
  };
});

vi.mock("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    ADMIN_JWT_SECRET: "test-admin-secret-that-is-at-least-32-characters",
    APP_URL: "http://localhost:3000",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    superAdmin: { findUnique: mocks.superAdminFindUnique },
    school: { findMany: mocks.schoolFindMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: mocks.bcryptCompare,
    hash: mocks.bcryptHash,
  },
}));

vi.mock("@/lib/notifications", () => ({ sendEmail: mocks.sendEmail }));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  resetRateLimit: mocks.resetRateLimit,
  clientIp: mocks.clientIp,
  tooManyRequests: mocks.tooManyRequests,
}));

import {
  ADMIN_COOKIE_NAME,
  signAdminToken,
  verifyAdminSessionFromRequest,
} from "@/lib/admin-auth";
import { POST as loginAdmin } from "@/app/api/admin/auth/login/route";
import { POST as logoutAdmin } from "@/app/api/admin/auth/logout/route";
import { POST as createSchool } from "@/app/api/admin/schools/route";
import { POST as resendSchoolInvite } from "@/app/api/admin/schools/[id]/invite/route";
import { POST as changeAdminPassword } from "@/app/api/admin/settings/password/route";

const ADMIN_ID = "admin-1";
const CURRENT_HASH = "current-password-hash";
const NEW_HASH = "new-password-hash";

async function authenticatedRequest(
  path: string,
  body?: unknown,
  passwordHash = CURRENT_HASH
): Promise<Request> {
  const token = await signAdminToken(ADMIN_ID, passwordHash);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      cookie: `${ADMIN_COOKIE_NAME}=${token}`,
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function validSchoolBody(email = "School.Admin@Example.com") {
  return {
    schoolName: "Test School",
    email,
    contactNumber: "0500000000",
    educationStages: ["kindergarten"],
  };
}

function adminRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return adminRouteFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

beforeEach(() => {
  for (const value of Object.values(mocks)) {
    if (typeof value === "function" && "mockReset" in value) value.mockReset();
  }

  mocks.superAdminFindUnique.mockResolvedValue({
    id: ADMIN_ID,
    email: "admin@example.com",
    password_hash: CURRENT_HASH,
  });
  mocks.userFindUnique.mockResolvedValue(null);
  mocks.schoolCreate.mockResolvedValue({ id: "school-1", name: "Test School" });
  mocks.schoolFindUnique.mockResolvedValue({ id: "school-1", name: "Test School" });
  mocks.userCreate.mockResolvedValue({ id: "user-1" });
  mocks.userFindFirst.mockResolvedValue({
    id: "user-1",
    schoolId: "school-1",
    name: "School Owner",
    email: "school.admin@example.com",
    password: null,
    acceptedAt: null,
    disabledAt: null,
  });
  mocks.schoolAdminInvitationCreate.mockResolvedValue({ id: "invite-1" });
  mocks.schoolAdminInvitationUpdateMany.mockResolvedValue({ count: 1 });
  mocks.adminActivityCreate.mockResolvedValue({ id: "log-1" });
  mocks.superAdminUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(
    async (operation: (tx: typeof mocks.tx) => Promise<unknown>) => operation(mocks.tx)
  );
  mocks.bcryptCompare.mockResolvedValue(false);
  mocks.bcryptHash.mockResolvedValue(NEW_HASH);
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.rateLimit.mockResolvedValue({ ok: true, remaining: 4, retryAfter: 0 });
  mocks.resetRateLimit.mockResolvedValue(undefined);
  mocks.clientIp.mockReturnValue("127.0.0.1");
  mocks.tooManyRequests.mockImplementation((retryAfter: number) =>
    Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    )
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin route protection", () => {
  it("keeps every non-auth, non-cron admin route behind an explicit session check", () => {
    const root = resolve(process.cwd(), "src/app/api/admin");
    const unprotected = adminRouteFiles(root)
      .map((path) => ({
        relativePath: relative(root, path).replaceAll("\\", "/"),
        source: readFileSync(path, "utf8"),
      }))
      .filter(({ relativePath }) => {
        return (
          relativePath !== "auth/login/route.ts" &&
          relativePath !== "auth/logout/route.ts" &&
          !relativePath.startsWith("cron/")
        );
      })
      .filter(({ source }) => !source.includes("verifyAdminSessionFromRequest"))
      .map(({ relativePath }) => relativePath);

    expect(unprotected).toEqual([]);
  });
});

describe("admin sessions and authentication routes", () => {
  it("accepts a valid bound session and invalidates it after the password hash changes", async () => {
    const request = await authenticatedRequest("/api/admin/overview");

    await expect(verifyAdminSessionFromRequest(request)).resolves.toEqual({
      adminId: ADMIN_ID,
    });

    mocks.superAdminFindUnique.mockResolvedValue({
      id: ADMIN_ID,
      password_hash: NEW_HASH,
    });
    await expect(verifyAdminSessionFromRequest(request)).resolves.toBeNull();
  });

  it("rejects a tampered admin token", async () => {
    const token = await signAdminToken(ADMIN_ID, CURRENT_HASH);
    const [header, payload] = token.split(".");
    const request = new Request("http://localhost/api/admin/overview", {
      headers: { cookie: `${ADMIN_COOKIE_NAME}=${header}.${payload}.invalid-signature` },
    });

    await expect(verifyAdminSessionFromRequest(request)).resolves.toBeNull();
  });

  it("sets a hardened, non-cacheable admin cookie after a valid login", async () => {
    mocks.bcryptCompare.mockResolvedValue(true);

    const response = await loginAdmin(
      new Request("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ADMIN@EXAMPLE.COM", password: "secret" }),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toEqual(
      expect.stringContaining(`${ADMIN_COOKIE_NAME}=`)
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(mocks.superAdminFindUnique).toHaveBeenCalledWith({
      where: { email: "admin@example.com" },
    });
  });

  it("rate-limits admin login before reading the privileged account", async () => {
    mocks.rateLimit.mockResolvedValueOnce({ ok: false, remaining: 0, retryAfter: 60 });

    const response = await loginAdmin(
      new Request("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "secret" }),
      })
    );

    expect(response.status).toBe(429);
    expect(mocks.superAdminFindUnique).not.toHaveBeenCalled();
  });

  it("clears the same session cookie on logout without caching the response", async () => {
    const response = await logoutAdmin();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain(`${ADMIN_COOKIE_NAME}=`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("admin school creation", () => {
  it("rejects an unauthenticated request before opening a transaction", async () => {
    const response = await createSchool(
      new Request("http://localhost/api/admin/schools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validSchoolBody()),
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("creates the school, inactive owner, invitation, and audit log in one transaction", async () => {
    const response = await createSchool(
      await authenticatedRequest("/api/admin/schools", validSchoolBody())
    );
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { email: "school.admin@example.com" },
    });
    expect(mocks.schoolCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Test School",
          email: "school.admin@example.com",
        }),
        select: { id: true, name: true },
      })
    );
    expect(mocks.userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "school.admin@example.com",
        password: null,
        acceptedAt: null,
        schoolId: "school-1",
      }),
      select: { id: true },
    });
    expect(mocks.schoolAdminInvitationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        schoolId: "school-1",
        userId: "user-1",
        expiresAt: expect.any(Date),
      }),
    });
    expect(mocks.adminActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        school_id: "school-1",
        action: "school_created",
        metadata: {
          email: "school.admin@example.com",
          userId: "user-1",
          adminId: ADMIN_ID,
        },
      }),
    });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(result.emailDelivery).toBe("sent");
    expect(result.invitationStatus).toBe("pending");
    expect(result).not.toHaveProperty("tempPassword");
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("tokenHash");
  });

  it("stores only hashes while emailing distinct CSPRNG invitation tokens", async () => {
    const mathRandom = vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.schoolCreate
      .mockResolvedValueOnce({ id: "school-1", name: "First" })
      .mockResolvedValueOnce({ id: "school-2", name: "Second" });

    const firstResponse = await createSchool(
      await authenticatedRequest("/api/admin/schools", validSchoolBody("first@example.com"))
    );
    const secondResponse = await createSchool(
      await authenticatedRequest("/api/admin/schools", validSchoolBody("second@example.com"))
    );
    const first = await firstResponse.json();
    const second = await secondResponse.json();

    const bodies = mocks.sendEmail.mock.calls.map((call) => String(call[2]));
    const tokens = bodies.map((body) => body.match(/\/activate\/([A-Za-z0-9_-]+)/)?.[1]);
    const hashes = mocks.schoolAdminInvitationCreate.mock.calls.map(
      (call) => call[0].data.tokenHash
    );

    expect(tokens[0]).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(tokens[1]).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(hashes).toEqual(tokens.map((token) => hashInviteToken(token!)));
    expect(JSON.stringify([first, second])).not.toContain(tokens[0]!);
    expect(JSON.stringify([first, second])).not.toContain(hashes[0]);
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it("does not send credentials or write an audit row when the transaction fails", async () => {
    mocks.userCreate.mockRejectedValue(new Error("simulated user insert failure"));

    const response = await createSchool(
      await authenticatedRequest("/api/admin/schools", validSchoolBody())
    );

    expect(response.status).toBe(500);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.adminActivityCreate).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the invitation resendable and reports email failure explicitly", async () => {
    mocks.sendEmail.mockResolvedValue({ success: false, error: "provider unavailable" });

    const response = await createSchool(
      await authenticatedRequest("/api/admin/schools", validSchoolBody())
    );
    const result = await response.json();

    expect(response.status).toBe(207);
    expect(result.emailDelivery).toBe("failed");
    const emailBody = String(mocks.sendEmail.mock.calls[0][2]);
    const token = emailBody.match(/\/activate\/([A-Za-z0-9_-]+)/)?.[1];
    const tokenHash = mocks.schoolAdminInvitationCreate.mock.calls[0][0].data.tokenHash;
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(token).toBeTruthy();
    expect(logged).not.toContain(token!);
    expect(logged).not.toContain(tokenHash);
    expect(logged).not.toContain("provider unavailable");
  });

  it("returns a conflict for a concurrent unique-email failure", async () => {
    mocks.transaction.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" }));

    const response = await createSchool(
      await authenticatedRequest("/api/admin/schools", validSchoolBody())
    );

    expect(response.status).toBe(409);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("admin school invitation rotation", () => {
  it("rejects an unauthenticated resend before any transaction", async () => {
    const response = await resendSchoolInvite(
      new Request("http://localhost/api/admin/schools/school-1/invite", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "school-1" }) }
    );

    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rate-limits resend requests before rotating an invitation", async () => {
    mocks.rateLimit.mockResolvedValueOnce({ ok: false, remaining: 0, retryAfter: 60 });

    const response = await resendSchoolInvite(
      await authenticatedRequest("/api/admin/schools/school-1/invite"),
      { params: Promise.resolve({ id: "school-1" }) }
    );

    expect(response.status).toBe(429);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("revokes prior active invitations and creates one tenant-bound replacement", async () => {
    const response = await resendSchoolInvite(
      await authenticatedRequest("/api/admin/schools/school-1/invite"),
      { params: Promise.resolve({ id: "school-1" }) }
    );
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.schoolFindUnique).toHaveBeenCalledWith({
      where: { id: "school-1" },
      select: { id: true, name: true },
    });
    expect(mocks.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school-1" } })
    );
    expect(mocks.schoolAdminInvitationUpdateMany).toHaveBeenCalledWith({
      where: {
        schoolId: "school-1",
        userId: "user-1",
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.schoolAdminInvitationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schoolId: "school-1",
        userId: "user-1",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(result).toEqual({ invitationStatus: "pending", emailDelivery: "sent" });
    expect(JSON.stringify(result)).not.toMatch(/token|password|hash/i);
  });

  it("does not cross a school boundary when resolving the owner", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({
      id: "user-1",
      schoolId: "different-school",
      name: "Wrong Owner",
      email: "wrong@example.com",
      password: null,
      acceptedAt: null,
      disabledAt: null,
    });

    const response = await resendSchoolInvite(
      await authenticatedRequest("/api/admin/schools/school-1/invite"),
      { params: Promise.resolve({ id: "school-1" }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.schoolAdminInvitationCreate).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the rotated invitation pending and reports delivery failure", async () => {
    mocks.sendEmail.mockResolvedValueOnce({ success: false, error: "provider unavailable" });

    const response = await resendSchoolInvite(
      await authenticatedRequest("/api/admin/schools/school-1/invite"),
      { params: Promise.resolve({ id: "school-1" }) }
    );
    const result = await response.json();

    expect(response.status).toBe(207);
    expect(result).toEqual({ invitationStatus: "pending", emailDelivery: "failed" });
    expect(mocks.schoolAdminInvitationCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses to turn an already-active owner back into an invited account", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({
      id: "user-1",
      schoolId: "school-1",
      name: "School Owner",
      email: "school.admin@example.com",
      password: "existing-hash",
      acceptedAt: new Date(),
      disabledAt: null,
    });

    const response = await resendSchoolInvite(
      await authenticatedRequest("/api/admin/schools/school-1/invite"),
      { params: Promise.resolve({ id: "school-1" }) }
    );

    expect(response.status).toBe(409);
    expect(mocks.schoolAdminInvitationCreate).not.toHaveBeenCalled();
  });
});

describe("admin password changes", () => {
  it("uses the shared password policy before reading or updating the account", async () => {
    const response = await changeAdminPassword(
      await authenticatedRequest("/api/admin/settings/password", {
        currentPassword: "old-password",
        newPassword: "short",
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects the wrong current password without writing anything", async () => {
    mocks.bcryptCompare.mockResolvedValue(false);

    const response = await changeAdminPassword(
      await authenticatedRequest("/api/admin/settings/password", {
        currentPassword: "wrong-password",
        newPassword: "new-password-value",
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.bcryptHash).not.toHaveBeenCalled();
  });

  it("atomically changes the hash and audit log, then replaces the current session", async () => {
    mocks.bcryptCompare
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mocks.bcryptHash.mockResolvedValue(NEW_HASH);
    const oldRequest = await authenticatedRequest("/api/admin/settings/password", {
      currentPassword: "old-password",
      newPassword: "new-password-value",
    });

    const response = await changeAdminPassword(oldRequest);

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.superAdminUpdateMany).toHaveBeenCalledWith({
      where: { id: ADMIN_ID, password_hash: CURRENT_HASH },
      data: { password_hash: NEW_HASH },
    });
    expect(mocks.adminActivityCreate).toHaveBeenCalledWith({
      data: {
        action: "admin_password_changed",
        performed_by: "super_admin",
        metadata: { adminId: ADMIN_ID },
      },
    });

    mocks.superAdminFindUnique.mockResolvedValue({
      id: ADMIN_ID,
      password_hash: NEW_HASH,
    });
    await expect(verifyAdminSessionFromRequest(oldRequest)).resolves.toBeNull();

    const cookie = response.headers.get("set-cookie") ?? "";
    const replacement = cookie.match(new RegExp(`${ADMIN_COOKIE_NAME}=([^;]+)`))?.[1];
    expect(replacement).toBeTruthy();
    const replacementRequest = new Request("http://localhost/api/admin/overview", {
      headers: { cookie: `${ADMIN_COOKIE_NAME}=${replacement}` },
    });
    await expect(verifyAdminSessionFromRequest(replacementRequest)).resolves.toEqual({
      adminId: ADMIN_ID,
    });
  });

  it("returns a conflict when another request changed the hash first", async () => {
    mocks.bcryptCompare
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mocks.superAdminUpdateMany.mockResolvedValue({ count: 0 });

    const response = await changeAdminPassword(
      await authenticatedRequest("/api/admin/settings/password", {
        currentPassword: "old-password",
        newPassword: "new-password-value",
      })
    );

    expect(response.status).toBe(409);
    expect(mocks.adminActivityCreate).not.toHaveBeenCalled();
  });

  it("does not report success when writing the audit log fails", async () => {
    mocks.bcryptCompare
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mocks.adminActivityCreate.mockRejectedValue(new Error("simulated audit failure"));

    const response = await changeAdminPassword(
      await authenticatedRequest("/api/admin/settings/password", {
        currentPassword: "old-password",
        newPassword: "new-password-value",
      })
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
