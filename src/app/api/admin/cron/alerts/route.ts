import { prisma } from "@/lib/prisma";
import { isAuthorizedCron, cronUnauthorized } from "@/lib/cron-auth";
import { formatDate } from "@/lib/utils";
import { schoolSubscriptionAccess } from "@/lib/school-subscription";
import { isPlanLimitExceeded } from "@/lib/plan-limits";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return cronUnauthorized();

  const now = new Date();
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const oneDayAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [rules, schools] = await Promise.all([
    prisma.automatedAlertRule.findMany({ where: { is_active: true } }),
    prisma.school.findMany({
      include: {
        subscription_plan: true,
        _count: { select: { students: { where: { isActive: true, deletedAt: null } } } },
      },
    }),
  ]);

  // Subscription state must not depend on whether an "expired" message rule is
  // enabled. Access already derives from the date; this persists the same state
  // once per school so the Super Admin lists and automated audiences agree.
  const newlyExpired = schools.filter(
    (school) =>
      ["active", "trial"].includes(school.subscription_status) &&
      schoolSubscriptionAccess(school, now).mode !== "active"
  );
  if (newlyExpired.length > 0) {
    for (const school of newlyExpired) {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.school.updateMany({
          where: {
            id: school.id,
            subscription_status: { in: ["active", "trial"] },
          },
          data: { subscription_status: "expired" },
        });
        if (changed.count === 1) {
          await tx.adminActivityLog.create({
            data: {
              school_id: school.id,
              action: "subscription_expired_automatically",
              performed_by: "system",
              metadata: { renewalDate: schoolSubscriptionAccess(school, now).renewalDate },
            },
          });
        }
      });
    }
    for (const school of newlyExpired) school.subscription_status = "expired";
  }

  const results: string[] = [];

  for (const rule of rules) {
    for (const school of schools) {
      let shouldSend = false;
      let messageBody = rule.message_template
        .replace(/<school_name>/g, school.name)
        .replace(
          /<plan_name>/g,
          school.subscription_plan?.name ?? (school.plan_id ? "" : "التجريبية")
        )
        // Through `formatDate`, not `toLocaleDateString`: this runs on Vercel,
        // whose host clock is UTC, so an unqualified format names the previous
        // day for every renewal after 21:00 Riyadh — in a message telling a
        // school when its subscription expires.
        .replace(
          /<renewal_date>/g,
          school.renewal_date ? formatDate(school.renewal_date) : ""
        )
        .replace(/<threshold_days>/g, String(rule.threshold_days ?? 0));

      if (rule.trigger_type === "no_login") {
        const threshold = rule.threshold_days ?? 7;
        const cutoff = new Date(now.getTime() - threshold * 24 * 60 * 60 * 1000);
        shouldSend = !school.last_login_at || school.last_login_at < cutoff;
      } else if (rule.trigger_type === "renewal_soon") {
        shouldSend = !!(school.renewal_date && school.renewal_date <= sevenDaysAhead && school.renewal_date >= now);
      } else if (rule.trigger_type === "renewal_tomorrow") {
        shouldSend = !!(school.renewal_date && school.renewal_date <= oneDayAhead && school.renewal_date >= now);
      } else if (rule.trigger_type === "expired") {
        shouldSend = !!(school.renewal_date && school.renewal_date < now && school.subscription_status !== "suspended");
        if (shouldSend) {
          const access = schoolSubscriptionAccess(school, now);
          messageBody += access.mode === "grace"
            ? `\n\nبقي ${access.graceDaysRemaining} يوم قبل انتقال الحساب إلى وضع القراءة فقط. يمكنك التجديد من صفحة اشتراك النظام.`
            : "\n\nالحساب الآن في وضع القراءة فقط حتى يتم تجديد الاشتراك.";
        }
      } else if (rule.trigger_type === "plan_limit") {
        shouldSend = !!(
          school.subscription_plan &&
          isPlanLimitExceeded(school._count.students, school.subscription_plan.max_students)
        );
      }

      if (!shouldSend) continue;

      // Dedup: skip if already sent within 24h
      const recentRecipient = await prisma.adminMessageRecipient.findFirst({
        where: {
          school_id: school.id,
          delivered_at: { gte: oneDayAgo },
          message: { template_key: rule.trigger_type },
        },
      });
      if (recentRecipient) continue;

      const message = await prisma.adminMessage.create({
        data: {
          subject: rule.message_subject,
          body: messageBody,
          is_automated: true,
          template_key: rule.trigger_type,
          target_type: "system",
          sent_at: now,
          recipients: {
            create: { school_id: school.id, delivered_at: now },
          },
        },
      });

      await prisma.adminActivityLog.create({
        data: {
          school_id: school.id,
          action: "alert_triggered",
          metadata: { trigger: rule.trigger_type, messageId: message.id },
          performed_by: "system",
        },
      });

      results.push(`${rule.trigger_type} → ${school.name}`);
    }
  }

  return Response.json({ triggered: results.length, results });
}
