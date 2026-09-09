import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  findOrThrow: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  school: {
    updateMany: mocks.updateMany,
    findUnique: mocks.findUnique,
    findUniqueOrThrow: mocks.findOrThrow,
  },
  adminActivityLog: { create: mocks.audit },
} }));

import { PUT } from "@/app/api/admin/schools/[id]/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ id: "super-admin" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findUnique.mockResolvedValue({ id: "school-1" });
  mocks.findOrThrow.mockResolvedValue({ id: "school-1", name: "Updated school" });
  mocks.audit.mockResolvedValue({});
});

describe("super-admin school identity editing", () => {
  it("keeps the established admin route authoritative for all read-only tenant identity fields", async () => {
    const identity = {
      expectedUpdatedAt: "2026-09-07T00:00:00.000Z",
      name: "Updated school",
      email: "school@example.invalid",
      commercialRegistration: "CR-1",
      vatNumber: "VAT-1",
      contactNumber: "+966500000001",
      phoneNumber: "+966500000002",
      address: "Address",
    };
    const response = await PUT(new Request("http://localhost/api/admin/schools/school-1", {
      method: "PUT",
      body: JSON.stringify(identity),
    }), { params: Promise.resolve({ id: "school-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "school-1", updatedAt: new Date(identity.expectedUpdatedAt) },
      data: expect.objectContaining({ name: identity.name, email: identity.email }),
    });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: { changedFields: expect.arrayContaining(["name", "email"]) },
    }) });
  });

  it("does not permit the route without a super-admin session", async () => {
    mocks.verify.mockResolvedValue(null);
    const response = await PUT(new Request("http://localhost/api/admin/schools/school-1", {
      method: "PUT",
      body: JSON.stringify({ name: "Nope" }),
    }), { params: Promise.resolve({ id: "school-1" }) });
    expect(response.status).toBe(401);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an outdated school form without writing an audit entry", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const response = await PUT(new Request("http://localhost/api/admin/schools/school-1", {
      method: "PUT",
      body: JSON.stringify({ expectedUpdatedAt: "2026-09-06T00:00:00.000Z", name: "Stale" }),
    }), { params: Promise.resolve({ id: "school-1" }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "STALE_RECORD" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
