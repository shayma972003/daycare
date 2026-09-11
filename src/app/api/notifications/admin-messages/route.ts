import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { withNoStore } from "@/lib/auth-response";
import { z } from "zod";
import { replaceVariables } from "@/lib/utils";
import { moneyNumber } from "@/lib/money";
import { isPlanLimitExceeded } from "@/lib/plan-limits";
import type { Prisma } from "@/generated/prisma/client";

const patchSchema = z.object({ recipientId: z.string().min(1).optional() }).strict();

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      name: true,
      renewal_date: true,
      subscription_plan: {
        select: { name: true, price: true, billing_interval: true, max_students: true },
      },
      _count: {
        select: { students: { where: { isActive: true, deletedAt: null } } },
      },
    },
  });
  const locale = request.headers.get("accept-language")?.toLowerCase().startsWith("en") ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn";
  const variables = {
    school_name: school?.name ?? session.user.schoolName,
    plan_name: school?.subscription_plan?.billing_interval === "YEARLY" ? "سنوي" : school?.subscription_plan?.billing_interval === "MONTHLY" ? "شهري" : school?.subscription_plan?.name ?? "",
    renewal_date: school?.renewal_date ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(school.renewal_date) : "",
    amount_due: school?.subscription_plan ? `${moneyNumber(school.subscription_plan.price)} ر.س` : "",
  };

  const planLimitActive = Boolean(
    school?.subscription_plan &&
      isPlanLimitExceeded(school._count.students, school.subscription_plan.max_students)
  );
  const recipientWhere: Prisma.AdminMessageRecipientWhereInput = {
    school_id: schoolId,
    // A plan-limit message is a snapshot from the time it was generated. Do
    // not keep presenting it as a current warning after the school is back
    // within its cap or has moved to an unlimited plan.
    ...(planLimitActive ? {} : { NOT: { message: { template_key: "plan_limit" } } }),
  };

  const recipients = await prisma.adminMessageRecipient.findMany({
    where: recipientWhere,
    include: { message: { select: { id: true, subject: true, body: true, sent_at: true } } },
    orderBy: { message: { sent_at: "desc" } },
    take: 20,
  });

  const unreadCount = await prisma.adminMessageRecipient.count({
    where: { ...recipientWhere, read_at: null, delivered_at: { not: null } },
  });

  const messages = recipients.map((r) => ({
      recipientId: r.id,
      messageId: r.message.id,
      subject: replaceVariables(r.message.subject, variables),
      body: replaceVariables(r.message.body, variables),
      sent_at: r.message.sent_at,
      read_at: r.read_at,
      system: false,
    }));

  if (session.subscription.mode !== "active") {
    const body = session.subscription.mode === "grace"
      ? `انتهى الاشتراك. بقي ${session.subscription.graceDaysRemaining} يوم قبل انتقال الحساب إلى وضع القراءة فقط. يمكنك التجديد الآن دون فقد أي بيانات.`
      : "الاشتراك غير نشط. يمكنك تصفح بيانات الحضانة، لكن تعديل البيانات متوقف حتى تجديد الاشتراك.";
    messages.unshift({
      recipientId: `subscription:${session.subscription.mode}`,
      messageId: `subscription:${session.subscription.renewalDate ?? "none"}`,
      subject: session.subscription.mode === "grace" ? "تنبيه مهلة تجديد الاشتراك" : "الحساب في وضع القراءة فقط",
      body,
      sent_at: new Date(),
      read_at: null,
      system: true,
    });
  }

  return withNoStore(Response.json({
    unreadCount: unreadCount + (session.subscription.mode === "active" ? 0 : 1),
    messages,
  }));
}

export async function PATCH(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return withNoStore(Response.json({ error: parsed.error.flatten() }, { status: 422 }));
  }
  const { recipientId } = parsed.data;
  if (recipientId) {
    const recipient = await prisma.adminMessageRecipient.findFirst({
      where: { id: recipientId, school_id: schoolId },
      include: { message: { select: { subject: true } } },
    });
    await prisma.adminMessageRecipient.updateMany({
      where: { id: recipientId, school_id: schoolId },
      data: { read_at: new Date() },
    });
    await logAction({
      school_id: schoolId,
      action: `فتح إشعار إداري: ${recipient?.message.subject ?? ""}`,
      entity_type: "notification",
      entity_id: recipientId,
      performed_by: session.user.name ?? "المدير",
      request,
    });
  } else {
    // Mark all as read
    await prisma.adminMessageRecipient.updateMany({
      where: { school_id: schoolId, read_at: null },
      data: { read_at: new Date() },
    });
    await logAction({
      school_id: schoolId,
      action: "تحديد جميع الإشعارات الإدارية كمقروءة",
      entity_type: "notification",
      performed_by: session.user.name ?? "المدير",
      request,
    });
  }

  return withNoStore(Response.json({ success: true }));
}
