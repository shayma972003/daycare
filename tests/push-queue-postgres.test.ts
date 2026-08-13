import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.PUSH_LEASE_SCHEMA;
const suite = schema ? describe : describe.skip;
let prisma: PrismaClient;
let drainPushQueue: typeof import("@/lib/push").drainPushQueue;
const fetchMock = vi.fn();

suite("6F push queue on PostgreSQL", () => {
  beforeAll(async () => {
    if (!schema || !/^codex_6f_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe PUSH_LEASE_SCHEMA");
    }
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.includes("neon")) {
      throw new Error("6F PostgreSQL tests only accept Neon");
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    vi.doMock("@/lib/prisma", () => ({ prisma }));
    process.env.FCM_SERVER_KEY = "test-only-key";
    process.env.FCM_PROJECT_ID = "test-only-project";
    vi.stubGlobal("fetch", fetchMock);
    ({ drainPushQueue } = await import("@/lib/push"));

    await prisma.school.create({ data: { id: "6f_school", name: "6F" } });
    await prisma.user.create({
      data: {
        id: "6f_user",
        name: "Worker",
        email: "6f-worker@example.test",
        schoolId: "6f_school",
        acceptedAt: new Date(),
      },
    });
    await prisma.deviceToken.create({
      data: {
        id: "6f_device",
        schoolId: "6f_school",
        userId: "6f_user",
        platform: "WEB",
        token: "6f-device-token-long-enough",
      },
    });
  });

  beforeEach(async () => {
    fetchMock.mockReset();
    await prisma.pushNotification.deleteMany();
    await prisma.user.update({ where: { id: "6f_user" }, data: { disabledAt: null } });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/prisma");
    await prisma?.$disconnect();
  });

  it("lets two workers send one queued row only once", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await prisma.pushNotification.create({
      data: { id: "6f_concurrent", schoolId: "6f_school", deviceTokenId: "6f_device", title: "T", body: "B" },
    });

    const outcomes = await Promise.all([drainPushQueue(1), drainPushQueue(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcomes.reduce((sum, value) => sum + value.sent, 0)).toBe(1);
    await expect(prisma.pushNotification.findUnique({ where: { id: "6f_concurrent" } })).resolves.toMatchObject({
      status: "SENT",
      attempts: 1,
      leaseToken: null,
      leaseExpiresAt: null,
    });
  });

  it("reclaims an expired lease and clears it after delivery", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await prisma.pushNotification.create({
      data: {
        id: "6f_expired_app",
        schoolId: "6f_school",
        deviceTokenId: "6f_device",
        title: "T",
        body: "B",
        leaseToken: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(drainPushQueue(1)).resolves.toMatchObject({ sent: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records a retryable failure without sending through a real provider", async () => {
    fetchMock.mockResolvedValue(new Response("provider unavailable", { status: 503 }));
    await prisma.pushNotification.create({
      data: { id: "6f_retry", schoolId: "6f_school", deviceTokenId: "6f_device", title: "T", body: "B" },
    });
    await expect(drainPushQueue(1)).resolves.toMatchObject({ failed: 1 });
    await expect(prisma.pushNotification.findUnique({ where: { id: "6f_retry" } })).resolves.toMatchObject({
      status: "PENDING",
      attempts: 1,
      leaseToken: null,
      leaseExpiresAt: null,
    });
  });

  it("does not send to a disabled owner", async () => {
    await prisma.user.update({ where: { id: "6f_user" }, data: { disabledAt: new Date() } });
    await prisma.pushNotification.create({
      data: { id: "6f_disabled", schoolId: "6f_school", deviceTokenId: "6f_device", title: "T", body: "B" },
    });
    await expect(drainPushQueue(1)).resolves.toMatchObject({ abandoned: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
