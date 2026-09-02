import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  school: { update: mocks.update },
  adminActivityLog: { create: mocks.audit },
} }));

import { PUT } from "@/app/api/admin/schools/[id]/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ id: "super-admin" });
  mocks.update.mockImplementation(async ({ data }: { data: object }) => ({ id: "school-1", ...data }));
  mocks.audit.mockResolvedValue({});
});

describe("super-admin school identity editing", () => {
  it("keeps the established admin route authoritative for all read-only tenant identity fields", async () => {
    const identity = {
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
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "school-1" },
      data: expect.objectContaining(identity),
    });
  });

  it("does not permit the route without a super-admin session", async () => {
    mocks.verify.mockResolvedValue(null);
    const response = await PUT(new Request("http://localhost/api/admin/schools/school-1", {
      method: "PUT",
      body: JSON.stringify({ name: "Nope" }),
    }), { params: Promise.resolve({ id: "school-1" }) });
    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
