import "dotenv/config";
import { randomBytes } from "crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

/**
 * Development seed.
 *
 * Two things were wrong with the previous version. It crashed: the student
 * records carried `guardianName1` and `phone1`, which do not exist on Student —
 * guardian data lives on its own model. And only the school, user and settings
 * used upsert, so a second run duplicated every teacher, class, student and
 * activity.
 *
 * Credentials come from the environment. Hardcoding a known password into a
 * script that can be pointed at any database is how test credentials end up
 * live.
 */

const SCHOOL_EMAIL = process.env.SEED_SCHOOL_EMAIL ?? "admin@nour.edu.sa";
const SCHOOL_PASSWORD = process.env.SEED_SCHOOL_PASSWORD;

async function main() {
  if (!SCHOOL_PASSWORD || SCHOOL_PASSWORD.length < 8) {
    throw new Error(
      "SEED_SCHOOL_PASSWORD is required (min 8 characters). Set it in .env before seeding."
    );
  }

  console.log("seeding…");

  // School.email is not unique, so this cannot be an upsert.
  const school =
    (await prisma.school.findFirst({ where: { email: SCHOOL_EMAIL } })) ??
    (await prisma.school.create({
      data: {
        name: "روضة النور",
        email: SCHOOL_EMAIL,
        plan: "premium",
        // Without this the kiosk page 404s until someone opens the attendance screen.
        attendanceToken: randomBytes(24).toString("base64url"),
        attendanceTokenCreatedAt: new Date(),
        studentCheckinTime: "07:30",
        studentCheckoutTime: "16:00",
        teacherCheckinTime: "07:00",
        teacherCheckoutTime: "16:30",
      },
    }));
  console.log(`school: ${school.name}`);

  const user = await prisma.user.upsert({
    where: { email: SCHOOL_EMAIL },
    update: {},
    create: {
      name: "مدير الروضة",
      email: SCHOOL_EMAIL,
      password: await bcrypt.hash(SCHOOL_PASSWORD, 12),
      schoolId: school.id,
    },
  });
  console.log(`admin user: ${user.email}`);

  await prisma.settings.upsert({
    where: { schoolId: school.id },
    update: {},
    create: {
      schoolId: school.id,
      hourlyLateFee: 10,
      dailyStudentFee: 50,
      monthlyStudentFee: 1200,
    },
  });

  // Teachers — keyed on name within the school so re-running does not duplicate.
  const teacherSeeds = [
    {
      name: "سارة محمد",
      period: "MORNING" as const,
      email: "sara@nour.edu.sa",
      phone1: "+966501234567",
      monthlySalary: 5000,
      lateDeductionRate: 25,
      qualification1: "بكالوريوس تربية",
    },
    {
      name: "نورة علي",
      period: "EVENING" as const,
      email: "noura@nour.edu.sa",
      phone1: "+966507654321",
      monthlySalary: 4500,
      lateDeductionRate: 20,
    },
  ];

  const teachers = [];
  for (const seed of teacherSeeds) {
    const existing = await prisma.teacher.findFirst({
      where: { schoolId: school.id, name: seed.name },
    });
    teachers.push(
      existing ?? (await prisma.teacher.create({ data: { ...seed, schoolId: school.id } }))
    );
  }
  console.log(`teachers: ${teachers.length}`);

  const classSeeds = [
    { name: "كي جي 1 - أ", teacherId: teachers[0].id, group: "KG1" as const, period: "MORNING" as const },
    { name: "كي جي 2 - أ", teacherId: teachers[1].id, group: "KG2" as const, period: "EVENING" as const },
  ];

  const classes = [];
  for (const seed of classSeeds) {
    const existing = await prisma.class.findFirst({
      where: { schoolId: school.id, name: seed.name },
    });
    classes.push(
      existing ?? (await prisma.class.create({ data: { ...seed, schoolId: school.id } }))
    );
  }
  console.log(`classes: ${classes.length}`);

  // Guardians are their own model — this is what the old seed got wrong.
  const familySeeds = [
    {
      guardian: { name: "عبدالله أحمد", phone1: "+966551234567" },
      child: { name: "أحمد عبدالله", gender: "MALE" as const, classId: classes[0].id },
    },
    {
      guardian: { name: "سعد الفهد", phone1: "+966559876543" },
      child: { name: "فاطمة سعد", gender: "FEMALE" as const, classId: classes[0].id },
    },
    {
      guardian: { name: "خالد المطيري", phone1: "+966562345678" },
      child: { name: "محمد خالد", gender: "MALE" as const, classId: classes[1].id },
    },
    {
      guardian: { name: "إبراهيم العتيبي", phone1: "+966568765432" },
      child: { name: "نورة إبراهيم", gender: "FEMALE" as const, classId: classes[1].id },
    },
  ];

  // Enrolment dates make the student billable — without them the finance
  // dashboard reports zero revenue and the cause is not obvious.
  const enrollmentStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const enrollmentEnd = new Date(Date.UTC(new Date().getUTCFullYear(), 11, 31));

  let created = 0;
  for (const family of familySeeds) {
    const existingChild = await prisma.student.findFirst({
      where: { schoolId: school.id, name: family.child.name },
    });
    if (existingChild) continue;

    const guardian =
      (await prisma.guardian.findFirst({
        where: { schoolId: school.id, phone1: family.guardian.phone1 },
      })) ??
      (await prisma.guardian.create({
        data: { ...family.guardian, schoolId: school.id },
      }));

    await prisma.student.create({
      data: {
        ...family.child,
        schoolId: school.id,
        guardianId: guardian.id,
        period: "MORNING",
        paymentMethod: "CASH",
        paymentStatus: "PENDING",
        registrationDate: enrollmentStart,
        enrollment_date: enrollmentStart,
        enrollmentEndDate: enrollmentEnd,
      },
    });
    created++;
  }
  console.log(`students: ${created} created, ${familySeeds.length - created} already present`);

  const activityName = "رحلة الربيع";
  const existingActivity = await prisma.activity.findFirst({
    where: { schoolId: school.id, name: activityName },
  });
  if (!existingActivity) {
    await prisma.activity.create({
      data: {
        name: activityName,
        schoolId: school.id,
        teacherId: teachers[0].id,
        group: "KG1",
        period: "MORNING",
        childrenCount: 20,
        startDate: new Date("2026-05-15"),
        endDate: new Date("2026-05-15"),
        activityFee: 50,
        message:
          "مرحباً <guardian_name>، نود دعوة <child_name> لحضور فعالية <activity_name>. مع تحيات <school_name>",
        isActive: true,
      },
    });
  }

  console.log(`\ndone. sign in as ${SCHOOL_EMAIL}`);
}

main()
  .catch((error) => {
    console.error("seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
