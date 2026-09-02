import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  schoolFind: vi.fn(),
  schoolUpdate: vi.fn(),
  storeUpload: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireSession: mocks.session, sessionErrorResponse: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  school: { findUnique: mocks.schoolFind, update: mocks.schoolUpdate },
} }));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.logAction }));
vi.mock("@/lib/file-upload", () => ({
  storeUpload: mocks.storeUpload,
  isFailure: (result: { url?: string }) => !result.url,
  LOGO_TYPES: ["image/png"],
  LOGO_LABEL: "logo",
}));

import { PUT } from "@/app/api/settings/logo/route";

function requestWithLogo() {
  const form = new FormData();
  form.set("logo", new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" }));
  return new Request("http://localhost/api/settings/logo", { method: "PUT", body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.schoolFind.mockResolvedValue({ logoUrl: "/api/files/schools/school-1/old.png" });
  mocks.schoolUpdate.mockResolvedValue({ id: "school-1" });
  mocks.storeUpload.mockResolvedValue({ url: "/api/files/schools/school-1/new.png" });
  mocks.logAction.mockResolvedValue(undefined);
});

describe("school logo upload ownership", () => {
  it("requires settings.manage inside the handler", async () => {
    mocks.session.mockResolvedValue({ user: { schoolId: "school-1" }, can: () => false });
    const response = await PUT(requestWithLogo());
    expect(response.status).toBe(403);
    expect(mocks.storeUpload).not.toHaveBeenCalled();
  });

  it("stores a new logo with explicit SCHOOL ownership", async () => {
    mocks.session.mockResolvedValue({ user: { schoolId: "school-1", name: "Manager" }, can: () => true });
    const response = await PUT(requestWithLogo());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.storeUpload).toHaveBeenCalledWith(
      "school-1",
      expect.any(File),
      expect.objectContaining({
        ownerType: "SCHOOL",
        ownerId: "school-1",
        category: "school",
        previousUrl: "/api/files/schools/school-1/old.png",
      })
    );
    expect(mocks.schoolUpdate).toHaveBeenCalledWith({
      where: { id: "school-1" },
      data: { logoUrl: "/api/files/schools/school-1/new.png" },
    });
  });
});
