import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const results: string[] = [];

  for (const rule of rules) {
    for (const school of schools) {
      let shouldSend = false;
      let messageBody = rule.message_template
        .replace(/<school_name>/g, school.name)
        .replace(/<plan_name>/g, school.subscription_plan?.name ?? "")
        .replace(/<renewal_date>/g, school.renewal_date?.toLocaleDateString("ar-SA") ?? "")
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
      } else if (rule.trigger_type === "plan_limit") {
        shouldSend = !!(school.subscription_plan && school._count.students > school.subscription_plan.max_students);
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

      // Mark expired
      if (rule.trigger_type === "expired") {
        await prisma.school.update({ where: { id: school.id }, data: { subscription_status: "expired" } });
      }

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
