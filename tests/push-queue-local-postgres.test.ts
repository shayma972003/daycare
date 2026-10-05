import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString = process.env.LOCAL_POSTGRES_TEST_URL;
const suite = connectionString ? describe.sequential : describe.skip;

suite("push queue on local PostgreSQL", () => {
  let prisma: PrismaClient;
  let drainPushQueue: typeof import("@/lib/push").drainPushQueue;
  const fetchMock = vi.fn();
  const suffix = randomBytes(6).toString("hex");
  const schoolId = `push_school_${suffix}`;
  const userId = `push_user_${suffix}`;
  const guardianId = `push_guardian_${suffix}`;
  const guardianAccountId = `push_guardian_account_${suffix}`;
  const staffDeviceId = `push_staff_device_${suffix}`;
  const guardianDeviceId = `push_guardian_device_${suffix}`;

  beforeAll(async () => {
    if (!connectionString) throw new Error("LOCAL_POSTGRES_TEST_URL is required");
    const target = new URL(connectionString);
    const localHost = target.hostname === "127.0.0.1" || target.hostname === "localhost";
    if (!localHost || target.port !== "55432" || target.pathname !== "/daycare_test") {
      throw new Error("Push PostgreSQL test only accepts local daycare_test on port 55432");
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    vi.doMock("@/lib/prisma", () => ({ prisma }));
    vi.stubGlobal("fetch", fetchMock);
    ({ drainPushQueue } = await import("@/lib/push"));

    await prisma.school.create({ data: { id: schoolId, name: "Push local test" } });
    await prisma.user.create({
      data: {
        id: userId,
        schoolId,
        name: "موظفة تجريبية",
        email: `push-staff-${suffix}@example.test`,
        acceptedAt: new Date(),
      },
    });
    await prisma.guardian.create({
      data: { id: guardianId, schoolId, name: "ولي أمر تجريبي" },
    });
    await prisma.guardianAccount.create({
      data: {
        id: guardianAccountId,
        guardianId,
        schoolId,
        email: `push-guardian-${suffix}@example.test`,
        acceptedAt: new Date(),
      },
    });
    await prisma.deviceToken.createMany({
      data: [
        {
          id: staffDeviceId,
          schoolId,
          userId,
          platform: "EXPO",
          token: `ExponentPushToken[staff-${suffix}]`,
        },
        {
          id: guardianDeviceId,
          schoolId,
          guardianAccountId,
          platform: "EXPO",
          token: `ExponentPushToken[guardian-${suffix}]`,
        },
      ],
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/prisma");
    if (prisma) {
      await prisma.pushNotification.deleteMany({ where: { schoolId } });
      await prisma.deviceToken.deleteMany({ where: { schoolId } });
      await prisma.guardianAccount.deleteMany({ where: { schoolId } });
      await prisma.guardian.deleteMany({ where: { schoolId } });
      await prisma.user.deleteMany({ where: { schoolId } });
      await prisma.school.deleteMany({ where: { id: schoolId } });
      await prisma.$disconnect();
    }
  });

  it("delivers audible Expo pushes to both guardian and staff devices", async () => {
    fetchMock.mockImplementation(async () => new Response(
      JSON.stringify({ data: { status: "ok" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    await prisma.pushNotification.createMany({
      data: [
        { schoolId, deviceTokenId: staffDeviceId, title: "للمعلمة", body: "رسالة للمعلمة" },
        { schoolId, deviceTokenId: guardianDeviceId, title: "لولي الأمر", body: "رسالة لولي الأمر" },
      ],
    });

    await expect(drainPushQueue(2)).resolves.toMatchObject({ sent: 2, abandoned: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String(call[1]?.body));
      expect(body).toMatchObject({
        sound: "default",
        priority: "high",
        channelId: "daycare-alerts-v2",
      });
    }
    await expect(prisma.pushNotification.count({
      where: { schoolId, status: "SENT" },
    })).resolves.toBe(2);
  });
});
