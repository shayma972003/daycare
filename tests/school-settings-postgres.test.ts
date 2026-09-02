import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.SCHOOL_SETTINGS_TEST_SCHEMA;
const suite = schema ? describe.sequential : describe.skip;

suite("school settings Prisma mapping on isolated PostgreSQL", () => {
  let prisma: PrismaClient;
  const suffix = randomBytes(5).toString("hex");
  const schoolId = `codex_settings_school_${suffix}`;

  beforeAll(async () => {
    if (!schema || !/^codex_attendance_settings_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe SCHOOL_SETTINGS_TEST_SCHEMA");
    }
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.toLowerCase().includes("neon")) {
      throw new Error("School settings PostgreSQL test only accepts Neon");
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("writes and reads schedules, four fees, and SCHOOL-owned files in the explicit schema", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.school.create({
        data: {
          id: schoolId,
          name: "Isolated settings canary",
          logoUrl: `/api/files/schools/${schoolId}/logo.png`,
          teacherMorningCheckinTime: "07:00",
          teacherMorningCheckoutTime: "15:00",
          teacherEveningCheckinTime: "15:30",
          teacherEveningCheckoutTime: "22:00",
          studentMorningCheckinTime: "07:30",
          studentMorningCheckoutTime: "14:00",
          studentEveningCheckinTime: "16:00",
          studentEveningCheckoutTime: "21:30",
          teacherCheckinTime: "07:00",
          teacherCheckoutTime: "15:00",
          studentCheckinTime: "07:30",
          studentCheckoutTime: "14:00",
        },
      });
      await tx.settings.create({
        data: {
          schoolId,
          hourlyLateFee: 12.5,
          dailyStudentFee: 0,
          weeklyStudentFee: 70,
          monthlyStudentFee: 250,
          yearlyStudentFee: 2500,
        },
      });
      await tx.storedFile.create({
        data: {
          key: `schools/${schoolId}/logo.png`,
          schoolId,
          category: "school",
          ownerId: schoolId,
          ownerType: "SCHOOL",
          contentType: "image/png",
          sizeBytes: 1,
        },
      });
    });

    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, include: { settings: true } });
    expect(school.teacherMorningCheckinTime).toBe("07:00");
    expect(school.teacherEveningCheckinTime).toBe("15:30");
    expect(school.studentMorningCheckoutTime).toBe("14:00");
    expect(school.studentEveningCheckoutTime).toBe("21:30");
    expect(school.teacherCheckinTime).toBe("07:00");
    expect(school.studentCheckoutTime).toBe("14:00");
    expect(String(school.settings?.dailyStudentFee)).toBe("0");
    expect(String(school.settings?.weeklyStudentFee)).toBe("70");
    expect(String(school.settings?.monthlyStudentFee)).toBe("250");
    expect(String(school.settings?.yearlyStudentFee)).toBe("2500");
    expect(await prisma.storedFile.count({ where: { schoolId, ownerId: schoolId, ownerType: "SCHOOL" } })).toBe(1);
  });
});
