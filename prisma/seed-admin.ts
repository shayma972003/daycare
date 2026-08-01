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

/**
 * Seeds the platform-operator account and the default plans/alert rules.
 *
 * The credentials used to fall back to `admin@system.com` / `changeme123`, so
 * running this with no environment set minted a super-admin with a guessable
 * password — the single most privileged account in the system. Both values are
 * now required.
 */
async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required — there are no defaults."
    );
  }
  if (password.length < 12) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 12 characters.");
  }

  const password_hash = await bcrypt.hash(password, 12);

  // `update: {}` meant re-running with a changed password silently kept the old
  // hash, so rotation appeared to work and did not.
  await prisma.superAdmin.upsert({
    where: { email },
    update: { password_hash },
    create: { email, password_hash },
  });
  console.log(`super admin ready: ${email}`);

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
  console.log(`plans ready: ${plans.length}`);

  const alertRules = [
    { trigger_type: "no_login", threshold_days: 7, message_subject: "نذكرك بتسجيل الدخول", message_template: "مرحباً <school_name>، لم نرَك منذ <threshold_days> أيام. يسعدنا دائماً مساعدتك." },
    { trigger_type: "renewal_soon", threshold_days: 7, message_subject: "اشتراكك ينتهي قريباً", message_template: "عزيزي <school_name>، اشتراكك في خطة <plan_name> ينتهي بتاريخ <renewal_date>. يرجى التجديد للاستمرار." },
    { trigger_type: "renewal_tomorrow", threshold_days: 1, message_subject: "اشتراكك ينتهي غداً", message_template: "تنبيه: اشتراك <school_name> ينتهي غداً. تواصل معنا الآن لتجديد اشتراكك." },
    { trigger_type: "expired", threshold_days: 0, message_subject: "انتهى اشتراكك", message_template: "انتهى اشتراك <school_name>. تواصل معنا لإعادة التفعيل." },
    { trigger_type: "plan_limit", threshold_days: 0, message_subject: "تجاوزت حد خطتك", message_template: "مدرسة <school_name> تجاوزت الحد الأقصى للطلاب في خطة <plan_name>. يرجى الترقية." },
  ];

  for (const rule of alertRules) {
    const existing = await prisma.automatedAlertRule.findFirst({
      where: { trigger_type: rule.trigger_type },
    });
    if (!existing) await prisma.automatedAlertRule.create({ data: rule });
  }
  console.log(`alert rules ready: ${alertRules.length}`);
}

main()
  .catch((error) => {
    // Was `.catch(console.error)`, which exited 0 — a failed seed reported
    // success to CI and to anyone reading the deploy log.
    console.error("admin seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
