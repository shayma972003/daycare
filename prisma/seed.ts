import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // Create a school
  const school = await prisma.school.upsert({
    where: { id: "school-1" },
    update: {},
    create: {
      id: "school-1",
      name: "روضة النور",
      email: "admin@nour.edu.sa",
      plan: "premium",
    },
  });
  console.log("✅ School created:", school.name);

  // Create admin user
  const hashedPassword = await bcrypt.hash("admin123", 12);
  const user = await prisma.user.upsert({
    where: { email: "admin@nour.edu.sa" },
    update: {},
    create: {
      name: "مدير الروضة",
      email: "admin@nour.edu.sa",
      password: hashedPassword,
      schoolId: school.id,
    },
  });
  console.log("✅ Admin user created:", user.email);

  // Create settings
  await prisma.settings.upsert({
    where: { schoolId: school.id },
    update: {},
    create: {
      schoolId: school.id,
      hourlyLateFee: 10,
      dailyStudentFee: 50,
      monthlyStudentFee: 1200,
      reminderTemplate:
        "مرحباً، <guardian_name>، نود إعلامكم بأن الرسوم المستحقة على <child_name> بمبلغ <amount_due> ريال تستحق بتاريخ <due_date>. مع تحيات <school_name>",
    },
  });
  console.log("✅ Settings created");

  // Create teachers
  const teacher1 = await prisma.teacher.create({
    data: {
      name: "سارة محمد",
      schoolId: school.id,
      period: "MORNING",
      email: "sara@nour.edu.sa",
      phone1: "0501234567",
      monthlySalary: 5000,
      lateDeductionRate: 25,
      qualification1: "بكالوريوس تربية",
    },
  });

  const teacher2 = await prisma.teacher.create({
    data: {
      name: "نورة علي",
      schoolId: school.id,
      period: "EVENING",
      email: "noura@nour.edu.sa",
      phone1: "0507654321",
      monthlySalary: 4500,
      lateDeductionRate: 20,
    },
  });
  console.log("✅ Teachers created");

  // Create classes
  const class1 = await prisma.class.create({
    data: {
      name: "كي جي 1 - أ",
      schoolId: school.id,
      teacherId: teacher1.id,
      group: "kg1",
      period: "MORNING",
    },
  });

  const class2 = await prisma.class.create({
    data: {
      name: "كي جي 2 - أ",
      schoolId: school.id,
      teacherId: teacher2.id,
      group: "kg2",
      period: "EVENING",
    },
  });
  console.log("✅ Classes created");

  // Create students
  const students = [
    {
      name: "أحمد عبدالله",
      classId: class1.id,
      gender: "MALE" as const,
      paymentStatus: "PAID" as const,
      guardianName1: "عبدالله أحمد",
      phone1: "0551234567",
    },
    {
      name: "فاطمة سعد",
      classId: class1.id,
      gender: "FEMALE" as const,
      paymentStatus: "LATE" as const,
      guardianName1: "سعد فاطمة",
      phone1: "0559876543",
    },
    {
      name: "محمد خالد",
      classId: class2.id,
      gender: "MALE" as const,
      paymentStatus: "PAID" as const,
      guardianName1: "خالد محمد",
      phone1: "0562345678",
    },
    {
      name: "نورة إبراهيم",
      classId: class2.id,
      gender: "FEMALE" as const,
      paymentStatus: "SUSPENDED" as const,
      guardianName1: "إبراهيم نورة",
      phone1: "0568765432",
    },
  ];

  for (const s of students) {
    await prisma.student.create({
      data: { ...s, schoolId: school.id, period: "MORNING", paymentMethod: "CASH" },
    });
  }
  console.log("✅ Students created");

  // Create an activity
  await prisma.activity.create({
    data: {
      name: "رحلة الربيع",
      schoolId: school.id,
      teacherId: teacher1.id,
      group: "kg1",
      period: "MORNING",
      childrenCount: 20,
      startDate: new Date("2026-05-15"),
      endDate: new Date("2026-05-15"),
      activityFee: 50,
      message:
        "مرحباً <guardian_name>، نود دعوة <child_name> لحضور فعالية <activity_name> في تاريخ 15 مايو. مع تحيات <school_name>",
      isActive: true,
    },
  });
  console.log("✅ Activity created");

  console.log("\n🎉 Seed complete!");
  console.log("📧 Login: admin@nour.edu.sa");
  console.log("🔑 Password: admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
