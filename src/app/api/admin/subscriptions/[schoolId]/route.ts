import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { addSchoolBillingPeriod } from "@/lib/school-subscription";

const schema = z.object({
  action: z.enum(["extend", "change_plan", "mark_paid"]),
  plan_id: z.string().optional(),
  note: z.string().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { schoolId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });

  const { action, plan_id } = parsed.data;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, include: { subscription_plan: true } });
  if (!school) return Response.json({ error: "Not found" }, { status: 404 });

  if (action === "extend") {
    const interval = school.subscription_plan?.billing_interval;
    if (!interval) return Response.json({ error: "اختاري الخطة الشهرية أو السنوية أولاً" }, { status: 409 });
    const base = school.renewal_date && school.renewal_date > new Date() ? school.renewal_date : new Date();
    const newDate = addSchoolBillingPeriod(base, interval);
    await prisma.school.update({ where: { id: schoolId }, data: { renewal_date: newDate, subscription_status: "active", suspended_at: null, suspension_reason: null } });
    await prisma.adminActivityLog.create({
      data: { school_id: schoolId, action: "renewal_extended", metadata: { newDate }, performed_by: "admin" },
    });
  } else if (action === "change_plan" && plan_id) {
    const plan = await prisma.subscriptionPlan.findFirst({ where: { id: plan_id, is_active: true, billing_interval: { in: ["MONTHLY", "YEARLY"] } } });
    if (!plan) return Response.json({ error: "الخطة غير متاحة" }, { status: 409 });
    await prisma.school.update({ where: { id: schoolId }, data: { plan_id } });
    await prisma.adminActivityLog.create({
      data: { school_id: schoolId, action: "plan_changed", metadata: { plan_id }, performed_by: "admin" },
    });
  } else if (action === "mark_paid") {
    await prisma.adminActivityLog.create({
      data: { school_id: schoolId, action: "renewal_extended", metadata: { note: parsed.data.note ?? "تم التحديد كمدفوع" }, performed_by: "admin" },
    });
  }

  const updated = await prisma.school.findUnique({ where: { id: schoolId } });
  return Response.json(updated);
}
