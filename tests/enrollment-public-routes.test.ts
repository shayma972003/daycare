import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
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
      updateMany: mocks.updateMany,
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
import { POST as submitEnrollment } from "@/app/api/enrollment/submit/route";
import { POST as uploadEnrollmentFile } from "@/app/api/enrollment/upload/route";

function validEnrollmentBody(overrides: Record<string, unknown> = {}) {
  return {
    token: "raw-token",
    full_name: "Child One",
    id_number: "1098765432",
    nationality: "سعودي",
    gender: "ذكر",
    period: "صباحي",
    date_of_birth: "2022-01-10",
    health_condition: "لا يوجد",
    allergies: "لا يوجد",
    guardian_name: "Guardian One",
    guardian_phone_1: "0500000001",
    guardian_phone_2: "0500000002",
    guardian_email: "guardian@example.com",
    guardian_name_2: "Guardian Two",
    guardian_email_2: "",
    enrollment_date: "2026-09-09",
    payment_method: "نقدي",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.PII_INDEX_PEPPER = randomBytes(48).toString("base64");
  mocks.findUnique.mockReset();
  mocks.update.mockReset();
  mocks.updateMany.mockReset().mockResolvedValue({ count: 1 });
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
    await expect(response.json()).resolves.toMatchObject({ valid: true });
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

  it("rejects a submission whose token does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await submitEnrollment(
      new Request("http://localhost/api/enrollment/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validEnrollmentBody({ token: "missing-token" })),
      })
    );

    expect(response.status).toBe(404);
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
  });

  it("accepts an upload when the signed enrollment link is valid", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "token-id",
      school_id: "school-1",
      status: "active",
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 3,
    });
    mocks.storeUpload.mockResolvedValue({ url: "/api/files/schools/school-1/evaluation.pdf" });
    const body = new FormData();
    body.set("token", "live-token");
    body.set("file", new File(["pdf"], "evaluation.pdf", { type: "application/pdf" }));

    const response = await uploadEnrollmentFile(
      new Request("http://localhost/api/enrollment/upload", { method: "POST", body })
    );

    expect(response.status).toBe(200);
    expect(mocks.storeUpload).toHaveBeenCalledOnce();
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
        body: JSON.stringify(validEnrollmentBody({
          evaluation_file_url: "/api/files/schools/school-1/students/token-id/file.pdf",
          evaluation_file_name: "file.pdf",
        })),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.submissionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id_number: null,
        encrypted_id_number: expect.any(String),
        id_number_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
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

  it("encrypts an ID before reserving a slot and never stores plaintext", async () => {
    const plaintext = "1098765432";
    mocks.findUnique.mockResolvedValue({
      id: "token-id",
      token: "raw-token",
      school_id: "school-1",
      status: "active",
      otp_verified: true,
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 3,
    });
    mocks.submissionCreate.mockResolvedValue({ id: "submission-1" });

    const response = await submitEnrollment(new Request("http://localhost/api/enrollment/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validEnrollmentBody({ id_number: plaintext })),
    }));

    expect(response.status).toBe(200);
    const data = mocks.submissionCreate.mock.calls[0]?.[0]?.data;
    expect(data.id_number).toBeNull();
    expect(data.encrypted_id_number).not.toContain(plaintext);
    expect(data.id_number_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain(plaintext);
  });

  it("does not write retired public fields supplied by an older client", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "token-id",
      token: "raw-token",
      school_id: "school-1",
      status: "active",
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 3,
    });
    mocks.submissionCreate.mockResolvedValue({ id: "submission-1" });

    const response = await submitEnrollment(new Request("http://localhost/api/enrollment/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validEnrollmentBody({
        academic_stage: "KG1",
        guardian_phone_3: "0500000003",
        guardian_phone_4: "0500000004",
      })),
    }));

    expect(response.status).toBe(200);
    const data = mocks.submissionCreate.mock.calls[0]?.[0]?.data;
    expect(data).not.toHaveProperty("academic_stage");
    expect(data).not.toHaveProperty("guardian_phone_3");
    expect(data).not.toHaveProperty("guardian_phone_4");
  });

  it("fails before the transaction when PII keys are unavailable", async () => {
    delete process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_INDEX_PEPPER;
    mocks.findUnique.mockResolvedValue({
      id: "token-id",
      school_id: "school-1",
      status: "active",
      otp_verified: true,
      expires_at: new Date(Date.now() + 60_000),
      submissions_count: 0,
      max_submissions: 3,
    });

    const response = await submitEnrollment(new Request("http://localhost/api/enrollment/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validEnrollmentBody()),
    }));

    expect(response.status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("1098765432");
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
        body: JSON.stringify(validEnrollmentBody()),
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
        body: JSON.stringify(validEnrollmentBody({
          evaluation_file_url: "/api/files/schools/school-1/students/other-token/file.pdf",
          evaluation_file_name: "file.pdf",
        })),
      })
    );

    expect(response.status).toBe(422);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
