import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  users: vi.fn(),
  selected: vi.fn(),
  transaction: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  activityCreate: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.users },
    arrivalRecipientSetting: { findMany: mocks.selected },
    $transaction: mocks.transaction,
  },
}));

import { GET, PUT } from "@/app/api/settings/arrival-recipients/route";

const tx = {
  arrivalRecipientSetting: {
    deleteMany: mocks.deleteMany,
    createMany: mocks.createMany,
  },
  activityLog: { create: mocks.activityCreate },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    user: { id: "manager-1", schoolId: "school-1", name: "Manager" },
    can: (permission: string) => permission === "settings.manage",
  });
  mocks.users.mockResolvedValue([
    {
      id: "staff-1",
      name: "Staff One",
      email: "staff@example.test",
      roleRef: { nameAr: "معلمة" },
    },
  ]);
  mocks.selected.mockResolvedValue([{ userId: "staff-1" }]);
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.createMany.mockResolvedValue({ count: 1 });
  mocks.activityCreate.mockResolvedValue({});
});

describe("arrival recipient settings", () => {
  it("lists only active accepted accounts for the signed-in school", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accounts: [
        {
          id: "staff-1",
          name: "Staff One",
          email: "staff@example.test",
          roleName: "معلمة",
        },
      ],
      selectedUserIds: ["staff-1"],
    });
    expect(mocks.users).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        schoolId: "school-1",
        disabledAt: null,
        acceptedAt: { not: null },
      },
    }));
  });

  it("rejects a recipient id that is disabled or belongs to another school", async () => {
    mocks.users.mockResolvedValue([]);
    const response = await PUT(new Request("http://localhost/api/settings/arrival-recipients", {
      method: "PUT",
      body: JSON.stringify({ userIds: ["outside-user"] }),
    }));
    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("replaces only this school's selection and accepts an empty list", async () => {
    const response = await PUT(new Request("http://localhost/api/settings/arrival-recipients", {
      method: "PUT",
      body: JSON.stringify({ userIds: [] }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ selectedUserIds: [] });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { schoolId: "school-1" } });
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.activityCreate).toHaveBeenCalledOnce();
  });
});
