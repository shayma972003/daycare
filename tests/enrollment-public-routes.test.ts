import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashOtp } from "@/lib/enrollment-otp";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  rateLimit: vi.fn(),
  storeUpload: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    enrollmentToken: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

vi.mock("@/lib/file-token", () => ({ stampFileUrl: (url: string | null) => url }));
vi.mock("@/lib/r2", () => ({ keyFromUrl: () => null, schoolIdFromKey: () => null }));
vi.mock("@/lib/file-upload", () => ({
  storeUpload: mocks.storeUpload,
  isFailure: () => false,
  DOCUMENT_TYPES: ["application/pdf"],
  DOCUMENT_LABEL: "document",
  MAX_ENROLLMENT_FILE_BYTES: 1024,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  clientIp: () => "127.0.0.1",
  tooManyRequests: (retryAfter: number) =>
    Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": String(retryAfter) } }),
}));

import { GET as verifyToken } from "@/app/api/enrollment/verify-token/[token]/route";
import { POST as verifyOtp } from "@/app/api/enrollment/verify-otp/route";
import { POST as submitEnrollment } from "@/app/api/enrollment/submit/route";
import { POST as uploadEnrollmentFile } from "@/app/api/enrollment/upload/route";

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.update.mockReset();
  mocks.storeUpload.mockReset();
  mocks.rateLimit.mockReset();
  mocks.rateLimit.mockResolvedValue({ ok: true, remaining: 10, retryAfter: 0 });
});

describe("public enrollment handlers", () => {
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
});
