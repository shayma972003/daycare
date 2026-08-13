import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashOtp } from "@/lib/enrollment-otp";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  submissionCreate: vi.fn(),
  transferOwnership: vi.fn(),
  queryRaw: vi.fn(),
  rateLimit: vi.fn(),
  storeUpload: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    enrollmentToken: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    enrollmentSubmission: {
      create: mocks.submissionCreate,
    },
  },
}));

vi.mock("@/lib/file-token", () => ({ stampFileUrl: (url: string | null) => url }));
vi.mock("@/lib/r2", () => ({
  keyFromUrl: (url: string | null) => url?.startsWith("/api/files/")
    ? url.slice("/api/files/".length)
    : null,
  schoolIdFromKey: (key: string) => /^schools\/([^/]+)\//.exec(key)?.[1] ?? null,
}));
vi.mock("@/lib/stored-files", () => {
  class StoredFileOwnershipError extends Error {}
  return {
    StoredFileOwnershipError,
    transferStoredFileOwnership: mocks.transferOwnership,
  };
});
vi.mock("@/lib/file-upload", () => ({
  storeUpload: mocks.storeUpload,
  isFailure: () => false,
  DOCUMENT_TYPES: ["application/pdf"],
  DOCUMENT_LABEL: "document",
  MAX_ENROLLMENT_FILE_BYTES: 1024,
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: mocks.rateLimit,
  clientIp: () => "127.0.0.1",
}));

import { GET as verifyToken } from "@/app/api/enrollment/verify-token/[token]/route";
import { POST as verifyOtp } from "@/app/api/enrollment/verify-otp/route";
import { POST as submitEnrollment } from "@/app/api/enrollment/submit/route";
import { POST as uploadEnrollmentFile } from "@/app/api/enrollment/upload/route";

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.update.mockReset();
  mocks.transaction.mockReset();
  mocks.submissionCreate.mockReset();
  mocks.transferOwnership.mockReset();
  mocks.storeUpload.mockReset();
  mocks.rateLimit.mockReset();
  mocks.rateLimit.mockResolvedValue({ status: "allowed", remaining: 10, retryAfter: 0 });
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({
      $queryRaw: mocks.queryRaw,
      enrollmentSubmission: { create: mocks.submissionCreate },
      storedFile: { updateMany: vi.fn() },
    })
  );
  mocks.queryRaw.mockResolvedValue([{ submissions_count: 1, max_submissions: 3 }]);
});

describe("public enrollment handlers", () => {
  it("returns 503 before reading enrollment data when the limiter store is unavailable", async () => {
    mocks.rateLimit.mockResolvedValueOnce({
      status: "unavailable",
      remaining: 0,
      retryAfter: 10,
    });

    const response = await verifyToken(
      new Request("http://localhost/api/enrollment/verify-token/public-token"),
      { params: Promise.resolve({ token: "public-token" }) }
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("public-token");
  });

  it("lets a parent validate a live enrollment token without a dashboard session", async () => {
    mocks.findUnique.mockResolvedValue({
      expires_at: new Date(Date.now() + 60_000),
      status: "active",
      submissions_count: 0,
      max_submissions: 3,
      sent_to_phone: null,
      sent_to_email: "parent@example.com",
      otp_verified: false,
      school: { name: "Test school", logoUrl: null },
    });

    const response = await verifyToken(
      new Request("http://localhost/api/enrollment/verify-token/live-token"),
      { params: Promise.resolve({ token: "live-token" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ valid: true, otpVerified: false });
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
  });

  it("rejects a missing enrollment token", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await verifyToken(
      new Request("http://localhost/api/enrollment/verify-token/missing-token"),
      { params: Promise.resolve({ token: "missing-token" }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
  });

  it("rejects an invalid OTP and consumes one token attempt", async () => {
    mocks.findUnique.mockResolvedValue({
      expires_at: new Date(Date.now() + 60_000),
      otp_verified: false,
      otp_attempts: 0,
      otp_expires_at: new Date(Date.now() + 60_000),
      otp_code_hash: hashOtp("654321"),
      school: { name: "Test school", logoUrl: null },
    });
    mocks.update.mockResolvedValue({ otp_attempts: 1 });

    const response = await verifyOtp(
      new Request("http://localhost/api/enrollment/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "live-token", otp_code: "123456" }),
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { token: "live-token" },
      data: { otp_attempts: { increment: 1 } },
      select: { otp_attempts: true },
    });
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
  });

  it("rejects a submission whose token does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await submitEnrollment(
      new Request("http://localhost/api/enrollment/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "missing-token", full_name: "Child" }),
      })
    );

    expect(response.status).toBe(404);
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
  });

  it("rejects an upload until the token's OTP has been verified", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "token-id",
      school_id: "school-1",
      status: "active",
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 3,
      otp_verified: false,
    });
    const body = new FormData();
    body.set("token", "live-token");
    body.set("file", new File(["pdf"], "evaluation.pdf", { type: "application/pdf" }));

    const response = await uploadEnrollmentFile(
      new Request("http://localhost/api/enrollment/upload", { method: "POST", body })
    );

    expect(response.status).toBe(403);
    expect(mocks.storeUpload).not.toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
  });

  it("binds an uploaded file to the internal enrollment token id", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "token-id",
      school_id: "school-1",
      status: "active",
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 3,
      otp_verified: true,
    });
    mocks.storeUpload.mockResolvedValue({
      url: "/api/files/schools/school-1/students/token-id/file.pdf",
      mime: "application/pdf",
      sizeBytes: 3,
    });
    const body = new FormData();
    body.set("token", "raw-public-token");
    body.set("file", new File(["pdf"], "evaluation.pdf", { type: "application/pdf" }));

    const response = await uploadEnrollmentFile(
      new Request("http://localhost/api/enrollment/upload", { method: "POST", body })
    );

    expect(response.status).toBe(200);
    expect(mocks.storeUpload).toHaveBeenCalledWith(
      "school-1",
      expect.any(File),
      expect.objectContaining({ ownerType: "ENROLLMENT_TOKEN", ownerId: "token-id" })
    );
    expect(JSON.stringify(mocks.storeUpload.mock.calls)).not.toContain("raw-public-token");
  });

  it("moves only the same token's file to the new submission", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "token-id",
      token: "raw-token",
      school_id: "school-1",
      otp_verified: true,
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 3,
    });
    mocks.submissionCreate.mockResolvedValue({ id: "submission-1" });
    mocks.update.mockResolvedValue({});

    const response = await submitEnrollment(
      new Request("http://localhost/api/enrollment/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "raw-token",
          full_name: "Child",
          evaluation_file_url: "/api/files/schools/school-1/students/token-id/file.pdf",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.transferOwnership).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        schoolId: "school-1",
        ownerType: "ENROLLMENT_TOKEN",
        ownerId: "token-id",
        nextOwnerType: "ENROLLMENT_SUBMISSION",
        nextOwnerId: "submission-1",
      })
    );
  });

  it("does not create a submission when the atomic slot reservation loses", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "token-id",
      token: "raw-token",
      school_id: "school-1",
      status: "active",
      otp_verified: true,
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 1,
    });
    mocks.queryRaw.mockResolvedValue([]);

    const response = await submitEnrollment(
      new Request("http://localhost/api/enrollment/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "raw-token", full_name: "Child" }),
      })
    );

    expect(response.status).toBe(429);
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("raw-token");
  });

  it("rejects a registered-looking URL when ownership belongs to another token", async () => {
    const { StoredFileOwnershipError } = await import("@/lib/stored-files");
    mocks.findUnique.mockResolvedValue({
      id: "token-id",
      school_id: "school-1",
      otp_verified: true,
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 3,
    });
    mocks.submissionCreate.mockResolvedValue({ id: "submission-1" });
    mocks.transferOwnership.mockRejectedValue(new StoredFileOwnershipError());

    const response = await submitEnrollment(
      new Request("http://localhost/api/enrollment/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "raw-token",
          full_name: "Child",
          evaluation_file_url: "/api/files/schools/school-1/students/other-token/file.pdf",
        }),
      })
    );

    expect(response.status).toBe(422);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
