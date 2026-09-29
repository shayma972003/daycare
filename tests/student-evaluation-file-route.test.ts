import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  studentFindFirst: vi.fn(),
  storedFileFindFirst: vi.fn(),
  readPrivateObject: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findFirst: mocks.studentFindFirst },
    storedFile: { findFirst: mocks.storedFileFindFirst },
  },
}));
vi.mock("@/lib/student-access-scope", () => ({
  studentClassWhere: () => ({ classId: { in: ["class-1"] } }),
}));
vi.mock("@/lib/file-upload", () => ({
  storeUpload: vi.fn(),
  isFailure: () => false,
  DOCUMENT_TYPES: [],
  DOCUMENT_LABEL: "document",
  MAX_DOCUMENT_BYTES: 4_000_000,
}));
vi.mock("@/lib/stored-files", () => ({ discardStoredFile: vi.fn() }));
vi.mock("@/lib/stored-file-ownership", () => ({
  STORED_FILE_OWNER: { STUDENT: "STUDENT" },
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: vi.fn() }));
vi.mock("@/lib/r2", () => ({
  keyFromUrl: (url: string) => url.startsWith("/api/files/") ? url.slice(11) : null,
  readPrivateObject: mocks.readPrivateObject,
}));

import { GET } from "@/app/api/students/[id]/evaluation/route";

const request = new Request("http://localhost/api/students/student-1/evaluation");
const params = { params: Promise.resolve({ id: "student-1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    user: { id: "manager-1", schoolId: "school-1" },
    can: (permission: string) => permission === "students.files",
  });
  mocks.studentFindFirst.mockResolvedValue({
    id: "student-1",
    evaluationFileUrl: "/api/files/schools/school-1/students/student-1/report.pdf",
    evaluationFileName: "evaluation.pdf",
  });
  mocks.storedFileFindFirst.mockResolvedValue({ contentType: "application/pdf" });
  mocks.readPrivateObject.mockResolvedValue({
    bytes: new TextEncoder().encode("private evaluation"),
    contentType: "application/pdf",
  });
});

describe("student evaluation file", () => {
  it("requires the student file permission", async () => {
    mocks.session.mockResolvedValue({
      user: { id: "staff-1", schoolId: "school-1" },
      can: () => false,
    });

    const response = await GET(request, params);

    expect(response.status).toBe(403);
    expect(mocks.studentFindFirst).not.toHaveBeenCalled();
  });

  it("checks the tenant, class scope and exact stored-file owner before reading", async () => {
    const response = await GET(request, params);

    expect(response.status).toBe(200);
    expect(mocks.studentFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "student-1",
        schoolId: "school-1",
        classId: { in: ["class-1"] },
      }),
    }));
    expect(mocks.storedFileFindFirst).toHaveBeenCalledWith({
      where: {
        key: "schools/school-1/students/student-1/report.pdf",
        schoolId: "school-1",
        ownerType: "STUDENT",
        ownerId: "student-1",
        deletePendingAt: null,
      },
      select: { contentType: true },
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(await response.text()).toBe("private evaluation");
  });

  it("does not read bytes when the registered owner does not match", async () => {
    mocks.storedFileFindFirst.mockResolvedValue(null);

    const response = await GET(request, params);

    expect(response.status).toBe(404);
    expect(mocks.readPrivateObject).not.toHaveBeenCalled();
  });

  it("keeps legacy data URLs behind the same session and scope checks", async () => {
    mocks.studentFindFirst.mockResolvedValue({
      id: "student-1",
      evaluationFileUrl: "data:application/pdf;base64,cHJpdmF0ZQ==",
      evaluationFileName: "old.pdf",
    });

    const response = await GET(request, params);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private");
    expect(mocks.storedFileFindFirst).not.toHaveBeenCalled();
    expect(mocks.readPrivateObject).not.toHaveBeenCalled();
  });
});
