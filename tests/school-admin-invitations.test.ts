import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const invitationFindUnique = vi.fn();
  const invitationUpdateMany = vi.fn();
  const invitationCreate = vi.fn();
  const userUpdateMany = vi.fn();
  const userFindFirst = vi.fn();
  const schoolFindUnique = vi.fn();
  const twoFaDeleteMany = vi.fn();
  const refreshDeleteMany = vi.fn();
  const resetDeleteMany = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn();
  const bcryptHash = vi.fn();

  const tx = {
    schoolAdminInvitation: {
      findUnique: invitationFindUnique,
      updateMany: invitationUpdateMany,
      create: invitationCreate,
    },
    user: { updateMany: userUpdateMany, findFirst: userFindFirst },
    school: { findUnique: schoolFindUnique },
    twoFASession: { deleteMany: twoFaDeleteMany },
    refreshToken: { deleteMany: refreshDeleteMany },
    passwordResetToken: { deleteMany: resetDeleteMany },
    adminActivityLog: { create: auditCreate },
  };

  return {
    invitationFindUnique,
    invitationUpdateMany,
    invitationCreate,
    userUpdateMany,
    userFindFirst,
    schoolFindUnique,
    twoFaDeleteMany,
    refreshDeleteMany,
    resetDeleteMany,
    auditCreate,
    transaction,
    bcryptHash,
    tx,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    schoolAdminInvitation: { findUnique: mocks.invitationFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("bcryptjs", () => ({
  default: { hash: mocks.bcryptHash },
}));

import { hashInviteToken, mintInvite } from "@/lib/invitations";
import {
  findSchoolAdminInvite,
  redeemSchoolAdminInvite,
  rotateSchoolAdminInvite,
} from "@/lib/school-admin-invitations";

const TOKEN = "A".repeat(32);
const NOW = new Date("2026-08-11T18:00:00.000Z");

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "invite-1",
    tokenHash: hashInviteToken(TOKEN),
    schoolId: "school-1",
    userId: "user-1",
    expiresAt: new Date("2026-08-12T18:00:00.000Z"),
    usedAt: null,
    revokedAt: null,
    user: {
      id: "user-1",
      schoolId: "school-1",
      name: "Owner",
      email: "owner@example.com",
      acceptedAt: null,
      disabledAt: null,
    },
    school: { name: "School One" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const value of Object.values(mocks)) {
    if (typeof value === "function" && "mockReset" in value) value.mockReset();
  }
  mocks.invitationFindUnique.mockResolvedValue(invitation());
  mocks.invitationUpdateMany.mockResolvedValue({ count: 1 });
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.twoFaDeleteMany.mockResolvedValue({ count: 0 });
  mocks.refreshDeleteMany.mockResolvedValue({ count: 0 });
  mocks.resetDeleteMany.mockResolvedValue({ count: 0 });
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.bcryptHash.mockResolvedValue("bcrypt-password-hash");
  mocks.transaction.mockImplementation(
    async (operation: (tx: typeof mocks.tx) => Promise<unknown>) => operation(mocks.tx)
  );
  mocks.schoolFindUnique.mockResolvedValue({ id: "school-1", name: "School One" });
  mocks.userFindFirst.mockResolvedValue({
    id: "user-1",
    schoolId: "school-1",
    name: "Owner",
    email: "owner@example.com",
    password: null,
    acceptedAt: null,
    disabledAt: null,
  });
  mocks.invitationCreate.mockResolvedValue({ id: "invite-2" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("school administrator invitation state", () => {
  it("accepts a valid invitation and rejects expired, used, and revoked states identically", async () => {
    await expect(findSchoolAdminInvite(TOKEN)).resolves.toEqual({
      kind: "staff",
      name: "Owner",
      email: "owner@example.com",
      schoolName: "School One",
    });

    for (const invalid of [
      invitation({ expiresAt: new Date("2026-08-10T18:00:00.000Z") }),
      invitation({ usedAt: NOW }),
      invitation({ revokedAt: NOW }),
    ]) {
      mocks.invitationFindUnique.mockResolvedValueOnce(invalid);
      await expect(findSchoolAdminInvite(TOKEN)).resolves.toBeNull();
    }
  });

  it("rejects an invitation whose user belongs to a different school", async () => {
    mocks.invitationFindUnique.mockResolvedValueOnce(
      invitation({
        user: {
          ...invitation().user,
          schoolId: "school-2",
        },
      })
    );

    await expect(findSchoolAdminInvite(TOKEN)).resolves.toBeNull();
  });
});

describe("atomic school administrator activation", () => {
  it("conditionally claims once, activates the bound user, invalidates sessions, and audits", async () => {
    const result = await redeemSchoolAdminInvite(TOKEN, "new-password");

    expect(result).toEqual({
      kind: "staff",
      name: "Owner",
      email: "owner@example.com",
      schoolName: "School One",
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.invitationUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "invite-1",
        schoolId: "school-1",
        userId: "user-1",
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { usedAt: NOW },
    });
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        schoolId: "school-1",
        acceptedAt: null,
        disabledAt: null,
      },
      data: {
        password: "bcrypt-password-hash",
        acceptedAt: NOW,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    expect(mocks.twoFaDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.refreshDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.resetDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        school_id: "school-1",
        action: "school_admin_invitation_accepted",
        performed_by: "school_admin",
        metadata: { userId: "user-1" },
      },
    });
  });

  it("allows only one of two concurrent claims to succeed", async () => {
    let claims = 0;
    mocks.invitationUpdateMany.mockImplementation(async (args) => {
      if (args.where.id) {
        claims += 1;
        return { count: claims === 1 ? 1 : 0 };
      }
      return { count: 0 };
    });

    const results = await Promise.all([
      redeemSchoolAdminInvite(TOKEN, "first-password"),
      redeemSchoolAdminInvite(TOKEN, "second-password"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    expect(mocks.userUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
  });

  it("propagates a downstream write failure so Prisma rolls back the conditional claim", async () => {
    mocks.userUpdateMany.mockRejectedValueOnce(new Error("user update failed"));

    await expect(
      redeemSchoolAdminInvite(TOKEN, "new-password")
    ).rejects.toThrow("user update failed");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});

describe("school administrator invitation rotation", () => {
  it("revokes the previous invitation before storing only the new token hash", async () => {
    const rotated = await rotateSchoolAdminInvite("school-1", "admin-1");
    const createData = mocks.invitationCreate.mock.calls[0][0].data;

    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith({
      where: {
        schoolId: "school-1",
        userId: "user-1",
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: NOW },
    });
    expect(createData.tokenHash).toBe(hashInviteToken(rotated.token));
    expect(createData.tokenHash).not.toContain(rotated.token);
    expect(createData).not.toHaveProperty("token");
    expect(rotated.token).toHaveLength(mintInvite().token.length);
  });
});
