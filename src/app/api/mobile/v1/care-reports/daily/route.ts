import { Prisma } from "@/generated/prisma/client";
import { logAction } from "@/lib/activity-logger";
import {
  buildDailyCareRows,
  dailyCareRequestHash,
  dailyReportSchema,
} from "@/lib/daily-care-batch";
import {
  assertNoDailyCareReportsToday,
  DailyCareAlreadySubmittedError,
} from "@/lib/daily-care-duplicates";
import {
  careReportSubmissionFields,
  loadCareReportPolicy,
  notifyApprovedCareReports,
  type CareReportSubmissionStatus,
} from "@/lib/care-report-policy";
import {
  mobileAuthResponse,
  requireMobileAuth,
  type MobileContext,
} from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { studentClassWhere } from "@/lib/student-access-scope";

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function replayBatch(
  schoolId: string,
  batchId: string,
  hash: string,
  access: MobileContext
) {
  const rows = await prisma.careReport.findMany({
    where: {
      schoolId,
      dailyBatchId: batchId,
      student: studentClassWhere(access),
    },
    select: { id: true, studentId: true, dailyBatchHash: true, reviewStatus: true },
  });
  if (rows.length === 0) return null;
  if (rows.some((row) => row.dailyBatchHash !== hash)) {
    return Response.json(
      { error: "استُخدم معرّف الإرسال لمحتوى مختلف", code: "IDEMPOTENCY_CONFLICT" },
      { status: 409 }
    );
  }
  const status: CareReportSubmissionStatus = rows.every((row) => row.reviewStatus === "APPROVED")
    ? "APPROVED"
    : "PENDING_REVIEW";
  await notifyApprovedCareReports(schoolId, rows.map((row) => row.id), status);
  return Response.json({ created: rows.length, replayed: true, status, reports: rows });
}

/** Saves the same unified daily-care batch used by the desktop form. */
export async function POST(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, {
      kind: "staff",
      permission: "attendance.students",
    });
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
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

  const schoolId = context.claims.schoolId;
  const payload = parsed.data;
  const hash = dailyCareRequestHash(payload);
  const replay = await replayBatch(schoolId, payload.idempotencyKey, hash, context);
  if (replay) return replay;
  const { reviewRequired } = await loadCareReportPolicy(schoolId);
  const submissionFields = careReportSubmissionFields(reviewRequired);

  const author = await prisma.user.findFirst({
    where: { id: context.claims.sub, schoolId },
    select: { name: true },
  });

  let created: { id: string; studentId: string }[];
  try {
    created = await prisma.$transaction(async (tx) => {
      const studentIds = payload.entries.map((entry) => entry.studentId);
      const students = await tx.student.findMany({
        where: {
          id: { in: studentIds },
          schoolId,
          deletedAt: null,
          anonymizedAt: null,
          isActive: true,
          ...studentClassWhere(context),
        },
        select: { id: true, classId: true },
      });
      if (students.length !== studentIds.length) throw new Error("INVALID_STUDENT_SET");

      await assertNoDailyCareReportsToday(tx, schoolId, studentIds);

      const reports = buildDailyCareRows(payload, schoolId, students, {
        teacherId: context.teacherId,
        name: author?.name ?? "المعلم",
      });
      if (reports.length === 0) throw new Error("EMPTY_DAILY_REPORT");

      const saved: { id: string; studentId: string }[] = [];
      for (const report of reports) {
        const row = await tx.careReport.create({
          data: { ...report, ...submissionFields },
          select: { id: true, studentId: true },
        });
        saved.push(row);
      }
      return saved;
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const concurrentReplay = await replayBatch(schoolId, payload.idempotencyKey, hash, context);
      if (concurrentReplay) return concurrentReplay;
      return Response.json(
        { error: "دفعة التقرير غير متاحة", code: "BATCH_NOT_AVAILABLE" },
        { status: 404 }
      );
    }
    if (error instanceof Error && error.message === "INVALID_STUDENT_SET") {
      return Response.json(
        { error: "تتضمن القائمة طفلاً غير متاح", code: "INVALID_STUDENT_SET" },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "EMPTY_DAILY_REPORT") {
      return Response.json(
        { error: "أدخلي بياناً واحداً على الأقل", code: "EMPTY_DAILY_REPORT" },
        { status: 422 }
      );
    }
    if (error instanceof DailyCareAlreadySubmittedError) {
      return Response.json(
        {
          error: "تم إرسال تقرير لهذا الطفل اليوم بالفعل",
          code: "DAILY_REPORT_ALREADY_SUBMITTED",
          studentIds: error.studentIds,
        },
        { status: 409 }
      );
    }
    throw error;
  }

  const status: CareReportSubmissionStatus = submissionFields.reviewStatus;
  await notifyApprovedCareReports(schoolId, created.map((row) => row.id), status);

  await logAction({
    school_id: schoolId,
    action: reviewRequired
      ? `إرسال التقرير اليومي من التطبيق للمراجعة لـ${payload.entries.length} طفل`
      : `إرسال التقرير اليومي من التطبيق مباشرة لأولياء الأمور لـ${payload.entries.length} طفل`,
    entity_type: "care_report_batch",
    entity_id: payload.idempotencyKey,
    performed_by: author?.name ?? "المعلم",
    request,
  });

  return Response.json(
    { created: created.length, replayed: false, status, reports: created },
    { status: 201 }
  );
}
