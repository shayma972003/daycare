import { Prisma } from "@/generated/prisma/client";
import { logAction } from "@/lib/activity-logger";
import {
  buildDailyCareRows,
  clearedDailyCareFields,
  dailyCareRequestHash,
  dailyReportSchema,
} from "@/lib/daily-care-batch";
import { mobileAuthResponse, requireMobileAuth } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { studentClassWhere } from "@/lib/student-access-scope";
import {
  careReportSubmissionFields,
  loadCareReportPolicy,
  notifyApprovedCareReports,
  type CareReportSubmissionStatus,
} from "@/lib/care-report-policy";

const keyOf = (row: { studentId: string; dailyItemKey?: string | null }) =>
  `${row.studentId}:${row.dailyItemKey ?? ""}`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  let context;
  try {
    context = await requireMobileAuth(request, {
      kind: "staff",
      permission: "attendance.students",
    });
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!context.teacherId) {
    return Response.json({ error: "Forbidden", code: "TEACHER_ONLY" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = dailyReportSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات التقرير غير صحيحة" }, { status: 422 });
  }

  const { batchId } = await params;
  if (parsed.data.idempotencyKey !== batchId) {
    return Response.json({ error: "معرّف الدفعة غير متطابق", code: "BATCH_ID_MISMATCH" }, { status: 409 });
  }

  const schoolId = context.claims.schoolId;
  const teacherId = context.teacherId;
  const payload = parsed.data;
  const hash = dailyCareRequestHash(payload);
  const now = new Date();
  const { reviewRequired } = await loadCareReportPolicy(schoolId);
  const submissionFields = careReportSubmissionFields(reviewRequired, now);
  const author = await prisma.user.findFirst({
    where: { id: context.claims.sub, schoolId },
    select: { name: true },
  });

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "CareReport" WHERE "schoolId" = ${schoolId} AND "dailyBatchId" = ${batchId} FOR UPDATE`
    );
    const existing = await tx.careReport.findMany({
      where: { schoolId, dailyBatchId: batchId },
      orderBy: [{ studentId: "asc" }, { dailyItemKey: "asc" }],
    });
    if (existing.length === 0) return { kind: "missing" as const };

    const active = existing.filter((row) => !row.deletedAt);
    if (active.length === 0 || active.some((row) => row.teacherId !== teacherId)) {
      return { kind: "missing" as const };
    }
    if (active.some((row) => row.reviewStatus === "APPROVED")) {
      return { kind: "invalid-state" as const };
    }
    if (!active.some((row) => row.reviewStatus === "REJECTED")) {
      if (active.every((row) => (
        row.reviewStatus === "PENDING_REVIEW" && row.dailyBatchHash === hash
      ))) {
        return {
          kind: "replayed" as const,
          count: active.length,
          reportIds: active.map((row) => row.id),
          status: "PENDING_REVIEW" as const,
        };
      }
      return { kind: "invalid-state" as const };
    }

    const requestedStudentIds = [...new Set(payload.entries.map((entry) => entry.studentId))].sort();
    const originalStudentIds = [...new Set(active.map((row) => row.studentId))].sort();
    if (
      requestedStudentIds.length !== originalStudentIds.length ||
      requestedStudentIds.some((studentId, index) => studentId !== originalStudentIds[index])
    ) {
      return { kind: "student-set-changed" as const };
    }

    const students = await tx.student.findMany({
      where: {
        id: { in: requestedStudentIds },
        schoolId,
        deletedAt: null,
        anonymizedAt: null,
        isActive: true,
        ...studentClassWhere(context),
      },
      select: { id: true, classId: true },
    });
    if (students.length !== requestedStudentIds.length) {
      return { kind: "student-unavailable" as const };
    }

    const desired = buildDailyCareRows(
      payload,
      schoolId,
      students,
      { teacherId, name: author?.name ?? "المعلم" },
      now
    );
    if (desired.length === 0) return { kind: "empty" as const };

    const existingByKey = new Map(existing.map((row) => [keyOf(row), row]));
    const desiredKeys = new Set(desired.map(keyOf));
    let saved = 0;
    const reportIds: string[] = [];

    for (const report of desired) {
      const prior = existingByKey.get(keyOf(report));
      if (prior) {
        const data: Prisma.CareReportUncheckedUpdateManyInput = {
          ...clearedDailyCareFields,
          ...report,
          deletedAt: null,
          summarizedAt: null,
          ...submissionFields,
        };
        const updated = await tx.careReport.updateMany({
          where: { id: prior.id, schoolId, dailyBatchId: batchId },
          data,
        });
        saved += updated.count;
        if (updated.count > 0) reportIds.push(prior.id);
      } else {
        const created = await tx.careReport.create({
          data: {
            ...report,
            ...submissionFields,
          },
          select: { id: true },
        });
        saved += 1;
        reportIds.push(created.id);
      }
    }

    const removedIds = active
      .filter((row) => !desiredKeys.has(keyOf(row)))
      .map((row) => row.id);
    if (removedIds.length > 0) {
      await tx.careReport.updateMany({
        where: { schoolId, id: { in: removedIds } },
        data: {
          deletedAt: now,
          reviewStatus: "PENDING_REVIEW",
          reviewedAt: null,
          reviewedById: null,
          reviewedByName: null,
          reviewNote: null,
          guardianNotifiedAt: null,
        },
      });
    }

    return {
      kind: "saved" as const,
      count: saved,
      reportIds,
      status: submissionFields.reviewStatus,
    };
  });

  if (outcome.kind === "missing") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (outcome.kind === "invalid-state") {
    return Response.json({
      error: "التقرير لم يعد في حالة الإرجاع للتعديل",
      code: "REPORT_NOT_RETURNED",
    }, { status: 409 });
  }
  if (outcome.kind === "student-set-changed") {
    return Response.json({
      error: "يجب إعادة إرسال التقرير لنفس الأطفال الموجودين في الدفعة الأصلية",
      code: "STUDENT_SET_CHANGED",
    }, { status: 409 });
  }
  if (outcome.kind === "student-unavailable") {
    return Response.json({
      error: "أحد الأطفال لم يعد متاحاً لهذه المعلمة",
      code: "STUDENT_UNAVAILABLE",
    }, { status: 409 });
  }
  if (outcome.kind === "empty") {
    return Response.json({ error: "أدخلي بياناً واحداً على الأقل", code: "EMPTY_DAILY_REPORT" }, { status: 422 });
  }

  if (outcome.kind === "saved") {
    await notifyApprovedCareReports(schoolId, outcome.reportIds, outcome.status);
    await logAction({
      school_id: schoolId,
      action: reviewRequired
        ? `إعادة إرسال تقرير الرعاية من التطبيق للمراجعة لـ${payload.entries.length} طفل`
        : `إعادة إرسال تقرير الرعاية من التطبيق مباشرة لأولياء الأمور لـ${payload.entries.length} طفل`,
      entity_type: "care_report_batch",
      entity_id: batchId,
      performed_by: author?.name ?? "المعلم",
      request,
    });
  }

  return Response.json({
    created: outcome.count,
    replayed: outcome.kind === "replayed",
    status: outcome.status satisfies CareReportSubmissionStatus,
  });
}
