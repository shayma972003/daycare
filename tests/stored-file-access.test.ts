import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storedFileFindFirst: vi.fn(),
  studentCount: vi.fn(),
  teacherCount: vi.fn(),
  tokenCount: vi.fn(),
  submissionCount: vi.fn(),
  guardianAccountFindFirst: vi.fn(),
  verifyAccessToken: vi.fn(),
  claimsForSubject: vi.fn(),
  verifyFileToken: vi.fn(),
  requireSession: vi.fn(),
  signedReadUrl: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ storageEnabled: true }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    storedFile: { findFirst: mocks.storedFileFindFirst },
    student: { count: mocks.studentCount },
    teacher: { count: mocks.teacherCount },
    enrollmentToken: { count: mocks.tokenCount },
    enrollmentSubmission: { count: mocks.submissionCount },
    guardianAccount: { findFirst: mocks.guardianAccountFindFirst },
  },
}));
vi.mock("@/lib/mobile-auth", () => ({
  bearerToken: (request: Request) => request.headers.get("authorization")?.slice(7) ?? null,
  verifyAccessToken: mocks.verifyAccessToken,
  claimsForSubject: mocks.claimsForSubject,
}));
vi.mock("@/lib/file-token", () => ({ verifyFileToken: mocks.verifyFileToken }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/r2", () => ({
  schoolIdFromKey: (key: string) => /^schools\/([^/]+)\//.exec(key)?.[1] ?? null,
  signedReadUrl: mocks.signedReadUrl,
}));

import { mayReadStoredFile } from "@/lib/stored-file-access";
import { GET as getStoredFile } from "@/app/api/files/[...key]/route";

const ownFile = {
  key: "schools/school-1/students/student-1/file.pdf",
  schoolId: "school-1",
  ownerType: "STUDENT" as const,
  ownerId: "student-1",
};

function bearerRequest(key = ownFile.key) {
  return new Request(`http://localhost/api/files/${key}`, {
    headers: { authorization: "Bearer mobile-token" },
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.verifyFileToken.mockReturnValue(false);
  mocks.studentCount.mockResolvedValue(1);
  mocks.verifyAccessToken.mockResolvedValue({
    sub: "account-1",
    kind: "staff",
    schoolId: "school-1",
  });
  mocks.claimsForSubject.mockResolvedValue({
    sub: "account-1",
    kind: "staff",
    schoolId: "school-1",
    permissions: ["students.files"],
  });
});

describe("StoredFile read authorization", () => {
  it("rejects an unregistered key without signing an R2 URL", async () => {
    mocks.storedFileFindFirst.mockResolvedValue(null);

    const response = await getStoredFile(bearerRequest(), {
      params: Promise.resolve({ key: ownFile.key.split("/") }),
    });

    expect(response.status).toBe(404);
    expect(mocks.signedReadUrl).not.toHaveBeenCalled();
  });

  it("keeps a signed grant exact to its registered key", async () => {
    mocks.verifyFileToken.mockImplementation((key: string, token: string | null) =>
      key === ownFile.key && token === "exact-grant"
    );
    mocks.requireSession.mockRejectedValue(new Error("no session"));

    await expect(mayReadStoredFile(
      new Request(`http://localhost/api/files/${ownFile.key}?t=exact-grant`),
      ownFile
    )).resolves.toBe(true);
    await expect(mayReadStoredFile(
      new Request("http://localhost/api/files/schools/school-1/students/student-2/file.pdf?t=exact-grant"),
      { ...ownFile, key: "schools/school-1/students/student-2/file.pdf", ownerId: "student-2" }
    )).resolves.toBe(false);
  });

  it("does not let a same-school session infer ambiguous LEGACY ownership from a key", async () => {
    mocks.requireSession.mockResolvedValue({
      user: { schoolId: "school-1" },
      can: () => true,
    });
    await expect(mayReadStoredFile(
      new Request("http://localhost/api/files/schools/school-1/students/enrollment/old.pdf"),
      {
        key: "schools/school-1/students/enrollment/old.pdf",
        schoolId: "school-1",
        ownerType: "LEGACY",
        ownerId: "enrollment",
      }
    )).resolves.toBe(false);
    expect(mocks.requireSession).not.toHaveBeenCalled();
  });

  it("rejects a fresh staff account from another tenant", async () => {
    mocks.claimsForSubject.mockResolvedValue({
      sub: "account-1",
      kind: "staff",
      schoolId: "school-2",
      permissions: ["students.files"],
    });

    await expect(mayReadStoredFile(bearerRequest(), ownFile)).resolves.toBe(false);
  });

  it("rejects staff without the file permission", async () => {
    mocks.claimsForSubject.mockResolvedValue({
      sub: "account-1",
      kind: "staff",
      schoolId: "school-1",
      permissions: ["students.view"],
    });

    await expect(mayReadStoredFile(bearerRequest(), ownFile)).resolves.toBe(false);
  });

  it("also enforces current dashboard permissions and tenant", async () => {
    mocks.requireSession.mockResolvedValue({
      user: { schoolId: "school-1" },
      can: () => false,
    });
    await expect(mayReadStoredFile(
      new Request(`http://localhost/api/files/${ownFile.key}`),
      ownFile
    )).resolves.toBe(false);

    mocks.requireSession.mockResolvedValue({
      user: { schoolId: "school-2" },
      can: () => true,
    });
    await expect(mayReadStoredFile(
      new Request(`http://localhost/api/files/${ownFile.key}`),
      ownFile
    )).resolves.toBe(false);
  });

  it("requires students.manage for pending enrollment files", async () => {
    const pendingFile = {
      key: "schools/school-1/students/submission-1/file.pdf",
      schoolId: "school-1",
      ownerType: "ENROLLMENT_SUBMISSION" as const,
      ownerId: "submission-1",
    };
    mocks.submissionCount.mockResolvedValue(1);
    mocks.claimsForSubject.mockResolvedValue({
      sub: "account-1",
      kind: "staff",
      schoolId: "school-1",
      permissions: ["students.files"],
    });
    await expect(mayReadStoredFile(bearerRequest(pendingFile.key), pendingFile))
      .resolves.toBe(false);

    mocks.claimsForSubject.mockResolvedValue({
      sub: "account-1",
      kind: "staff",
      schoolId: "school-1",
      permissions: ["students.manage"],
    });
    await expect(mayReadStoredFile(bearerRequest(pendingFile.key), pendingFile))
      .resolves.toBe(true);
  });

  it("lets a guardian read only a currently linked child", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      sub: "guardian-account-1",
      kind: "guardian",
      schoolId: "school-1",
    });
    mocks.claimsForSubject.mockResolvedValue({
      sub: "guardian-account-1",
      kind: "guardian",
      schoolId: "school-1",
    });
    mocks.guardianAccountFindFirst.mockResolvedValue({ guardianId: "guardian-1" });
    mocks.studentCount.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    await expect(mayReadStoredFile(bearerRequest(), ownFile)).resolves.toBe(true);
    expect(mocks.studentCount).toHaveBeenLastCalledWith({
      where: {
        id: "student-1",
        schoolId: "school-1",
        OR: [
          { guardianId: "guardian-1" },
          { guardianLinks: { some: { guardianId: "guardian-1" } } },
        ],
      },
    });

    mocks.studentCount.mockReset();
    mocks.studentCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(mayReadStoredFile(
      bearerRequest("schools/school-1/students/student-2/file.pdf"),
      { ...ownFile, key: "schools/school-1/students/student-2/file.pdf", ownerId: "student-2" }
    )).resolves.toBe(false);
  });

  it("rejects a disabled or otherwise revoked mobile account", async () => {
    mocks.claimsForSubject.mockResolvedValue(null);

    await expect(mayReadStoredFile(bearerRequest(), ownFile)).resolves.toBe(false);
  });
});
