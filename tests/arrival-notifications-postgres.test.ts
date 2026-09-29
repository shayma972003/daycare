import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString = process.env.LOCAL_POSTGRES_TEST_URL;
const suite = connectionString ? describe.sequential : describe.skip;

suite("guardian arrival cooldown on local PostgreSQL", () => {
  let prisma: PrismaClient;
  let createGuardianArrivalNotice: typeof import("@/lib/arrival-notifications").createGuardianArrivalNotice;
  const suffix = randomBytes(6).toString("hex");
  const schoolId = `arrival_school_${suffix}`;
  const guardianId = `arrival_guardian_${suffix}`;
  const guardianAccountId = `arrival_account_${suffix}`;
  const staffId = `arrival_staff_${suffix}`;

  beforeAll(async () => {
    if (!connectionString) throw new Error("LOCAL_POSTGRES_TEST_URL is required");
    const target = new URL(connectionString);
    const localHost = target.hostname === "127.0.0.1" || target.hostname === "localhost";
    if (!localHost || target.port !== "55432" || target.pathname !== "/daycare_test") {
      throw new Error("Arrival PostgreSQL test only accepts local daycare_test on port 55432");
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    vi.doMock("@/lib/prisma", () => ({ prisma }));
    vi.doMock("@/lib/push", () => ({ enqueuePush: vi.fn(async () => 0) }));
    ({ createGuardianArrivalNotice } = await import("@/lib/arrival-notifications"));

    await prisma.school.create({ data: { id: schoolId, name: "Arrival local test" } });
    await prisma.guardian.create({
      data: { id: guardianId, schoolId, name: "ولي تجريبي" },
    });
    await prisma.guardianAccount.create({
      data: {
        id: guardianAccountId,
        schoolId,
        guardianId,
        email: `arrival-${suffix}@example.test`,
        acceptedAt: new Date(),
      },
    });
    await prisma.user.create({
      data: {
        id: staffId,
        schoolId,
        name: "موظفة تجريبية",
        email: `arrival-staff-${suffix}@example.test`,
        acceptedAt: new Date(),
      },
    });
    await prisma.arrivalRecipientSetting.create({ data: { schoolId, userId: staffId } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.arrivalNotice.deleteMany({ where: { schoolId } });
      await prisma.arrivalRecipientSetting.deleteMany({ where: { schoolId } });
      await prisma.guardianAccount.deleteMany({ where: { schoolId } });
      await prisma.guardian.deleteMany({ where: { schoolId } });
      await prisma.user.deleteMany({ where: { schoolId } });
      await prisma.school.deleteMany({ where: { id: schoolId } });
      await prisma.$disconnect();
    }
    vi.doUnmock("@/lib/prisma");
    vi.doUnmock("@/lib/push");
  });

  it("allows only one of two simultaneous presses and snapshots the selected staff", async () => {
    const now = new Date("2026-09-29T09:00:00.000Z");
    const attempts = await Promise.all([
      createGuardianArrivalNotice({ schoolId, guardianAccountId, now }),
      createGuardianArrivalNotice({ schoolId, guardianAccountId, now }),
    ]);

    expect(attempts.filter((result) => result.created)).toHaveLength(1);
    expect(attempts.filter((result) => !result.created && result.reason === "COOLDOWN")).toHaveLength(1);

    const notices = await prisma.arrivalNotice.findMany({
      where: { schoolId },
      include: { recipients: true },
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      senderName: "ولي تجريبي",
      expectedAt: new Date("2026-09-29T09:05:00.000Z"),
    });
    expect(notices[0].recipients).toHaveLength(1);
    expect(notices[0].recipients[0].userId).toBe(staffId);
  }, 30_000);
});
