import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { calendarToday, storedDate, requestTimeZone } from "@/lib/device-date";
import { automaticSubscriptionEnd } from "@/lib/subscription-period";
import { generatePaymentCycles } from "@/lib/payment-cycles";
import { activityLogData } from "@/lib/activity-logger";
import { renewalNeedsReactivation } from "@/lib/student-lifecycle";
import { resolveStudentCycleFee, studentFeeSettingsSelect } from "@/lib/student-cycle-fee";

export const renewalFields = z.object({
  mode: z.enum(["automatic", "manual"]).optional(),
  enrollmentEndDate: z.iso.date().optional(),
  billingCycle: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"]).optional(),
  billingIntervalDays: z.number().int().positive().nullable().optional(),
  reactivate: z.boolean().optional(),
});
export type RenewalInput = z.infer<typeof renewalFields>;

export class RenewalError extends Error {
  constructor(public code: string, public status: number = 422) { super(code); }
}

/** Both single and bulk renewals use this transaction and the same rules. */
export async function renewStudentSubscription(input: RenewalInput, context: {
  id: string; schoolId: string; actor: string; request: Request;
}) {
  let timeZone: string;
  try { timeZone = requestTimeZone(context.request); }
  catch { throw new RenewalError("INVALID_TIME_ZONE"); }
  const today = calendarToday(new Date(), timeZone);
  const automatic = input.mode === "automatic" || (!input.mode && !input.enrollmentEndDate);
  if (!automatic && (!input.enrollmentEndDate || storedDate(input.enrollmentEndDate) < today)) throw new RenewalError("INVALID_RENEWAL_DATE");
  return prisma.$transaction(async (tx) => {
    // Serialize retries/overlapping renewals before reading the previous end.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Student" WHERE "id" = ${context.id} AND "schoolId" = ${context.schoolId} FOR UPDATE`);
    const current = await tx.student.findFirst({ where: { id: context.id, schoolId: context.schoolId, deletedAt: null } });
    if (!current) throw new RenewalError("NOT_FOUND", 404);
    if (current.anonymizedAt) throw new RenewalError("ANONYMIZED_STUDENT", 409);
    if (automatic && current.billingCycle === "CUSTOM" && !current.billingIntervalDays) throw new RenewalError("BILLING_INTERVAL_REQUIRED");
    const end = automatic ? automaticSubscriptionEnd(today, current.billingCycle, current.billingIntervalDays) : storedDate(input.enrollmentEndDate!);
    const needsReactivation = renewalNeedsReactivation(current);
    if (needsReactivation && !input.reactivate) throw new RenewalError("REACTIVATION_REQUIRED", 409);
    const previousEnd = current.enrollmentEndDate && storedDate(current.enrollmentEndDate);
    if (previousEnd && end < previousEnd) throw new RenewalError("RENEWAL_CANNOT_SHORTEN");
    const changedTerms = !automatic && (
      (input.billingCycle !== undefined && input.billingCycle !== current.billingCycle) ||
      (input.billingIntervalDays !== undefined && input.billingIntervalDays !== current.billingIntervalDays));
    if (previousEnd && previousEnd >= today && changedTerms) throw new RenewalError("ACTIVE_TERMS_CHANGE", 409);
    const samePeriod = previousEnd?.getTime() === end.getTime() && !changedTerms;
    const alreadyRenewed = samePeriod && !needsReactivation;
    // A serialized retry for the period that was just created is a true
    // idempotent read. In particular, do not consult today's fee settings or
    // rewrite the subscription snapshot: the first successful renewal owns
    // the dates, fee, payment state, and generated payment cycles.
    if (alreadyRenewed) {
      return {
        id: current.id,
        name: current.name,
        enrollmentEndDate: current.enrollmentEndDate,
        enrollment_date: current.enrollment_date,
        enrollmentDate: current.enrollment_date,
        billingCycle: current.billingCycle,
        billingIntervalDays: current.billingIntervalDays,
        cycleFee: current.cycleFee,
        isActive: current.isActive,
        status: current.status,
        paymentStatus: current.paymentStatus,
      };
    }
    const newPeriod = automatic || !previousEnd || previousEnd < today;
    const start = newPeriod ? today : (current.enrollment_date ? storedDate(current.enrollment_date) : today);
    if (end < start) throw new RenewalError("INVALID_RENEWAL_DATE");
    const billingCycle = automatic ? current.billingCycle : input.billingCycle ?? current.billingCycle;
    const interval = automatic || input.billingIntervalDays === undefined ? current.billingIntervalDays : input.billingIntervalDays;
    const settings = samePeriod || billingCycle === "CUSTOM" ? null : await tx.settings.findUnique({
      where: { schoolId: context.schoolId }, select: studentFeeSettingsSelect,
    });
    // Renewal starts a new price snapshot. Historical CUSTOM subscriptions keep
    // their explicit amount; the four supported products always use the latest
    // school setting at the renewal boundary.
    const effectiveFee = samePeriod
      ? current.cycleFee
      : resolveStudentCycleFee(
          billingCycle,
          billingCycle === "CUSTOM" ? current.cycleFee : null,
          settings,
        );
    if (!samePeriod && (effectiveFee === null || !effectiveFee.isFinite() || effectiveFee.isNegative())) throw new RenewalError("CYCLE_FEE_REQUIRED");
    if (billingCycle === "CUSTOM" && !interval) throw new RenewalError("BILLING_INTERVAL_REQUIRED");
    const updated = await tx.student.update({
      where: { id: context.id, schoolId: context.schoolId, deletedAt: null, anonymizedAt: null },
      data: {
        enrollmentEndDate: end,
        ...(newPeriod || !current.enrollment_date ? { enrollment_date: start } : {}),
        billingCycle, cycleFee: effectiveFee, billingIntervalDays: interval,
        ...(newPeriod || (previousEnd && end > previousEnd) ? { paymentStatus: "PENDING" as const } : {}),
        ...(needsReactivation ? {
          isActive: true, status: "ACTIVE", leftAt: null, retentionUntil: null,
          ...(current.paymentStatus === "CANCELLED" || current.paymentStatus === "SUSPENDED" ? { paymentStatus: "PENDING" as const } : {}),
        } : {}),
      },
      select: { id: true, name: true, enrollmentEndDate: true, enrollment_date: true, billingCycle: true, billingIntervalDays: true, cycleFee: true, isActive: true, status: true, paymentStatus: true },
    });
    const from = newPeriod ? today : new Date(previousEnd!.getTime() + 86_400_000);
    const createdCycles = from <= end ? await generatePaymentCycles(context.id, tx, from) : 0;
    // A previous period's PAID badge must not imply new dues are already paid.
    // Preserve an existing LATE state; never rewrite historical cycle statuses.
    if (createdCycles > 0 && updated.paymentStatus === "PAID") {
      await tx.student.update({ where: { id: context.id, schoolId: context.schoolId }, data: { paymentStatus: "PENDING" }, select: { paymentStatus: true } });
      updated.paymentStatus = "PENDING";
    }
    await tx.activityLog.create({ data: activityLogData({
      school_id: context.schoolId,
      action: needsReactivation ? "student subscription renewed and reactivated" : "student subscription renewed",
      entity_type: "student", entity_id: context.id, entity_name: updated.name,
      performed_by: context.actor, request: context.request,
    }) });
    // Match the profile GET/PUT contract. Keep the legacy alias for existing
    // clients while all visible subscription fields use the same saved values.
    return { ...updated, enrollmentDate: updated.enrollment_date };
  }, { timeout: 30_000 });
}
