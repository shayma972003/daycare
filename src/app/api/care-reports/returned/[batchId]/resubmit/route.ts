import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { scopedClassIds, studentClassWhere } from "@/lib/student-access-scope";
import {
  buildDailyCareRows,
  clearedDailyCareFields,
  dailyCareRequestHash,
  dailyReportSchema,
} from "@/lib/daily-care-batch";
import { logAction } from "@/lib/activity-logger";

const keyOf = (row: { studentId: string; dailyItemKey?: string | null }) =>
  `${row.studentId}:${row.dailyItemKey ?? ""}`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.teacherId || scopedClassIds(session) === null) {
    return Response.json({ error: "Forbidden", code: "TEACHER_ONLY" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = dailyReportSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });

  const { batchId } = await params;
  if (parsed.data.idempotencyKey !== batchId) {
    return Response.json({ error: "معرّف الدفعة غير متطابق", code: "BATCH_ID_MISMATCH" }, { status: 409 });
  }

  const schoolId = session.user.schoolId;
  const teacherId = session.teacherId;
  const payload = parsed.data;
  const hash = dailyCareRequestHash(payload);
  const now = new Date();

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
      if (active.every((row) => row.reviewStatus === "PENDING_REVIEW" && row.dailyBatchHash === hash)) {
        return { kind: "replayed" as const, count: active.length };
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
        ...studentClassWhere(session),
      },
      select: { id: true, classId: true },
    });
    if (students.length !== requestedStudentIds.length) return { kind: "student-unavailable" as const };

    const desired = buildDailyCareRows(
      payload,
      schoolId,
      students,
      { teacherId, name: session.user.name ?? "الطاقم" },
      now
    );
    if (desired.length === 0) return { kind: "empty" as const };

    const existingByKey = new Map(existing.map((row) => [keyOf(row), row]));
    const desiredKeys = new Set(desired.map(keyOf));
    let saved = 0;

    for (const report of desired) {
      const prior = existingByKey.get(keyOf(report));
      if (prior) {
        const data: Prisma.CareReportUncheckedUpdateManyInput = {
          ...clearedDailyCareFields,
          ...report,
          deletedAt: null,
          summarizedAt: null,
          reviewStatus: "PENDING_REVIEW",
          reviewedAt: null,
          reviewedById: null,
          reviewedByName: null,
          reviewNote: null,
          guardianNotifiedAt: null,
        };
        const updated = await tx.careReport.updateMany({
          where: { id: prior.id, schoolId, dailyBatchId: batchId },
          data,
        });
        saved += updated.count;
      } else {
        await tx.careReport.create({
          data: {
            ...report,
            reviewStatus: "PENDING_REVIEW",
            reviewedAt: null,
            reviewedById: null,
            reviewedByName: null,
            reviewNote: null,
            guardianNotifiedAt: null,
          },
        });
        saved += 1;
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

    return { kind: "saved" as const, count: saved };
  });

  if (outcome.kind === "missing") return Response.json({ error: "Not found" }, { status: 404 });
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
    return Response.json({ error: "أحد الأطفال لم يعد متاحاً لهذه المعلمة", code: "STUDENT_UNAVAILABLE" }, { status: 409 });
  }
  if (outcome.kind === "empty") {
    return Response.json({ error: "أدخلي بياناً واحداً على الأقل", code: "EMPTY_DAILY_REPORT" }, { status: 422 });
  }

  if (outcome.kind === "saved") {
    await logAction({
      school_id: schoolId,
      action: `إعادة إرسال تقرير الرعاية للمراجعة لـ${payload.entries.length} طفل`,
      entity_type: "care_report_batch",
      entity_id: batchId,
      performed_by: session.user.name ?? "الطاقم",
      request,
    });
  }

  return Response.json({
    created: outcome.count,
    replayed: outcome.kind === "replayed",
    status: "PENDING_REVIEW",
  });
}
