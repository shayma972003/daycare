import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  raw: vi.fn(),
  jobFind: vi.fn(),
  jobCount: vi.fn(),
  pushCount: vi.fn(),
  pushFirst: vi.fn(),
  outboundCount: vi.fn(),
  storageFind: vi.fn(),
  schoolCount: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/env", () => ({
  emailDeliveryEnabled: true,
  emailEnabled: true,
  emailProvider: "resend",
  storageEnabled: true,
  env: {
    CRON_SECRET: "configured",
    NEXT_PUBLIC_SENTRY_DSN: "https://public@example.invalid/1",
    ERROR_WEBHOOK_URL: undefined,
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: mocks.raw,
    systemJobRun: { findMany: mocks.jobFind, count: mocks.jobCount },
    pushNotification: { count: mocks.pushCount, findFirst: mocks.pushFirst },
    notificationLog: { count: mocks.outboundCount },
    storageUsage: { findMany: mocks.storageFind },
    school: { count: mocks.schoolCount },
  },
}));

import { GET } from "@/app/api/admin/system-health/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ adminId: "admin-1" });
  mocks.raw
    .mockResolvedValueOnce([{ ok: 1 }])
    .mockResolvedValueOnce([{ migration_name: "20261026190000_system_job_health", finished_at: new Date() }]);
  mocks.jobFind.mockResolvedValue([
    { id: "run-1", jobKey: "push_queue", status: "SUCCEEDED", startedAt: new Date(), finishedAt: new Date(), durationMs: 120, errorCode: null },
    { id: "run-2", jobKey: "care_digest", status: "FAILED", startedAt: new Date(), finishedAt: new Date(), durationMs: 80, errorCode: "JOB_FAILED" },
  ]);
  mocks.jobCount.mockResolvedValue(1);
  mocks.pushCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
  mocks.pushFirst.mockResolvedValue({ scheduledAt: new Date() });
  mocks.outboundCount.mockResolvedValue(1);
  mocks.storageFind.mockResolvedValue([{ schoolId: "school-1", totalBytes: 1024, computedAt: new Date() }]);
  mocks.schoolCount.mockResolvedValue(1);
});

describe("super-admin system health", () => {
  it("returns safe operational status without provider credentials or message content", async () => {
    const response = await GET(new Request("http://localhost/api/admin/system-health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      services: expect.arrayContaining([
        expect.objectContaining({ key: "database", state: "healthy" }),
        expect.objectContaining({ key: "email", configured: true }),
        expect.objectContaining({ key: "storage", configured: true }),
      ]),
      metrics24h: { failedJobRuns: 1, failedPush: 2, failedOutbound: 1, pendingPush: 3 },
      versions: { databaseMigration: "20261026190000_system_job_health" },
    });
    expect(body.jobs.find((job: { key: string }) => job.key === "care_digest").state).toBe("failed");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("FCM_SERVER_KEY");
    expect(serialized).not.toContain("CRON_SECRET");
    expect(serialized).not.toContain("recipientName");
    expect(serialized).not.toContain("content");
  });

  it("requires a super-admin session before running diagnostics", async () => {
    mocks.verify.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/system-health"));

    expect(response.status).toBe(401);
    expect(mocks.raw).not.toHaveBeenCalled();
  });
});
