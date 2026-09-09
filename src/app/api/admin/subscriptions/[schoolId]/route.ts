import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  addSchoolBillingPeriod,
  type SchoolSubscriptionType,
} from "@/lib/school-subscription";
import { Prisma } from "@/generated/prisma/client";

const schema = z.object({
  action: z.enum(["extend", "change_type", "change_plan", "mark_paid"]),
  subscription_type: z.enum(["TRIAL", "MONTHLY", "YEARLY"]).optional(),
  plan_id: z.string().optional(),
  note: z.string().optional(),
});

function paidInterval(type: SchoolSubscriptionType): "MONTHLY" | "YEARLY" | null {
  return type === "TRIAL" ? null : type;
}

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

  const { action, plan_id, subscription_type } = parsed.data;
  if (action === "change_type" && !subscription_type) {
    return Response.json({ error: "نوع الاشتراك مطلوب" }, { status: 422 });
  }
  if (action === "change_plan" && !plan_id) {
    return Response.json({ error: "الخطة مطلوبة" }, { status: 422 });
  }

  const now = new Date();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "School"
        WHERE "id" = ${schoolId}
        FOR UPDATE
      `);
      const school = await tx.school.findUnique({
        where: { id: schoolId },
        include: { subscription_plan: true },
      });
      if (!school) return null;

      if (action === "extend") {
        const interval = school.subscription_plan?.billing_interval
          ?? (school.subscription_status === "trial" || (school.subscription_status === "expired" && !school.plan_id)
            ? "MONTHLY"
            : null);
        if (!interval) throw new Error("SUBSCRIPTION_TYPE_REQUIRED");
        const base = school.renewal_date && school.renewal_date > now ? school.renewal_date : now;
        const renewalDate = addSchoolBillingPeriod(base, interval);
        const status = school.plan_id ? "active" : "trial";
        const result = await tx.school.update({
          where: { id: schoolId },
          data: {
            renewal_date: renewalDate,
            subscription_status: status,
            suspended_at: null,
            suspension_reason: null,
          },
          include: { subscription_plan: true },
        });
        await tx.adminActivityLog.create({
          data: {
            school_id: schoolId,
            action: "renewal_extended",
            metadata: { subscriptionType: status === "trial" ? "TRIAL" : interval, renewalDate },
            performed_by: "super_admin",
          },
        });
        return result;
      }

      if (action === "change_type" || action === "change_plan") {
        let type: SchoolSubscriptionType;
        let selectedPlan: { id: string; billing_interval: "MONTHLY" | "YEARLY" | null } | null = null;

        if (action === "change_plan") {
          selectedPlan = await tx.subscriptionPlan.findFirst({
            where: { id: plan_id!, is_active: true, billing_interval: { in: ["MONTHLY", "YEARLY"] } },
            select: { id: true, billing_interval: true },
          });
          if (!selectedPlan?.billing_interval) throw new Error("PLAN_NOT_AVAILABLE");
          type = selectedPlan.billing_interval;
        } else {
          type = subscription_type!;
          const interval = paidInterval(type);
          if (interval) {
            selectedPlan = await tx.subscriptionPlan.findFirst({
              where: { is_active: true, billing_interval: interval },
              select: { id: true, billing_interval: true },
            });
            if (!selectedPlan) throw new Error("PLAN_NOT_AVAILABLE");
          }
        }

        const interval = paidInterval(type) ?? "MONTHLY";
        const renewalDate = addSchoolBillingPeriod(now, interval);
        const result = await tx.school.update({
          where: { id: schoolId },
          data: {
            plan_id: selectedPlan?.id ?? null,
            subscription_status: type === "TRIAL" ? "trial" : "active",
            renewal_date: renewalDate,
            suspended_at: null,
            suspension_reason: null,
          },
          include: { subscription_plan: true },
        });
        await tx.adminActivityLog.create({
          data: {
            school_id: schoolId,
            action: "subscription_type_changed",
            metadata: {
              previousPlanId: school.plan_id,
              previousStatus: school.subscription_status,
              subscriptionType: type,
              planId: selectedPlan?.id ?? null,
              renewalDate,
            },
            performed_by: "super_admin",
          },
        });
        return result;
      }

      await tx.adminActivityLog.create({
        data: {
          school_id: schoolId,
          action: "subscription_marked_paid",
          metadata: { note: parsed.data.note ?? "تم التحديد كمدفوع" },
          performed_by: "super_admin",
        },
      });
      return tx.school.findUnique({ where: { id: schoolId }, include: { subscription_plan: true } });
    });

    if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "SUBSCRIPTION_TYPE_REQUIRED") {
      return Response.json({ error: "حددي نوع الاشتراك أولاً" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "PLAN_NOT_AVAILABLE") {
      return Response.json({ error: "الخطة غير متاحة" }, { status: 409 });
    }
    console.error("[admin-subscriptions] update failed", { schoolId, action });
    return Response.json({ error: "تعذر تحديث الاشتراك" }, { status: 500 });
  }
}
