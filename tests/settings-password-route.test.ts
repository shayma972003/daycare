import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findUser: vi.fn(),
  transaction: vi.fn(),
  updateUser: vi.fn(),
  deleteTwoFa: vi.fn(),
  deleteReset: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: mocks.findUser },
  $transaction: mocks.transaction,
} }));
vi.mock("bcryptjs", () => ({ default: {
  compare: mocks.compare,
  hash: mocks.hash,
} }));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));

import { PUT } from "@/app/api/settings/password/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    user: { id: "user-1", schoolId: "school-1", email: "manager@example.invalid", name: "Manager" },
  });
  mocks.findUser.mockResolvedValue({ id: "user-1", password: "old-hash" });
  mocks.compare.mockResolvedValue(true);
  mocks.hash.mockResolvedValue("new-hash");
  mocks.updateUser.mockResolvedValue({});
  mocks.deleteTwoFa.mockResolvedValue({ count: 2 });
  mocks.deleteReset.mockResolvedValue({ count: 1 });
  mocks.log.mockResolvedValue(undefined);
  const tx = {
    user: { update: mocks.updateUser },
    twoFASession: { deleteMany: mocks.deleteTwoFa },
    passwordResetToken: { deleteMany: mocks.deleteReset },
  };
  mocks.transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("school password session revocation", () => {
  it("changes the password, increments authVersion, and removes unfinished sessions atomically", async () => {
    const response = await PUT(new Request("http://localhost/api/settings/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword: "Old-password-1", newPassword: "New-password-2" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { password: "new-hash", authVersion: { increment: 1 } },
    });
    expect(mocks.deleteTwoFa).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.deleteReset).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("does not start the revocation transaction when the current password is wrong", async () => {
    mocks.compare.mockResolvedValueOnce(false);
    const response = await PUT(new Request("http://localhost/api/settings/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword: "Wrong-password-1", newPassword: "New-password-2" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
