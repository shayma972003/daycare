import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const hash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD ?? "changeme123", 12);
  await prisma.superAdmin.upsert({
    where: { email: process.env.SUPER_ADMIN_EMAIL ?? "admin@system.com" },
    update: {},
    create: {
      email: process.env.SUPER_ADMIN_EMAIL ?? "admin@system.com",
      password_hash: hash,
    },
  });

  const plans = [
    { name: "تجريبي", price: 0, max_students: 20, max_classes: 2, max_whatsapp_per_month: 50 },
    { name: "أساسي", price: 299, max_students: 100, max_classes: 10, max_whatsapp_per_month: 500 },
    { name: "متقدم", price: 599, max_students: 300, max_classes: 30, max_whatsapp_per_month: 2000 },
    { name: "مؤسسي", price: 999, max_students: 1000, max_classes: 100, max_whatsapp_per_month: 10000 },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { name: plan.name },
      update: {},
      create: plan,
    });
  }

  const alertRules = [
    { trigger_type: "no_login", threshold_days: 7, message_subject: "نذكرك بتسجيل الدخول", message_template: "مرحباً <school_name>، لم نرَك منذ <threshold_days> أيام. يسعدنا دائماً مساعدتك." },
    { trigger_type: "renewal_soon", threshold_days: 7, message_subject: "اشتراكك ينتهي قريباً", message_template: "عزيزي <school_name>، اشتراكك في خطة <plan_name> ينتهي بتاريخ <renewal_date>. يرجى التجديد للاستمرار." },
    { trigger_type: "renewal_tomorrow", threshold_days: 1, message_subject: "اشتراكك ينتهي غداً", message_template: "تنبيه: اشتراك <school_name> ينتهي غداً. تواصل معنا الآن لتجديد اشتراكك." },
    { trigger_type: "expired", threshold_days: 0, message_subject: "انتهى اشتراكك", message_template: "انتهى اشتراك <school_name>. تواصل معنا لإعادة التفعيل." },
    { trigger_type: "plan_limit", threshold_days: 0, message_subject: "تجاوزت حد خطتك", message_template: "مدرسة <school_name> تجاوزت الحد الأقصى للطلاب في خطة <plan_name>. يرجى الترقية." },
  ];

  for (const rule of alertRules) {
    const existing = await prisma.automatedAlertRule.findFirst({ where: { trigger_type: rule.trigger_type } });
    if (!existing) {
      await prisma.automatedAlertRule.create({ data: rule });
    }
  }

  console.log("Admin seeded successfully");
}

main().catch(console.error).finally(() => prisma.$disconnect());
