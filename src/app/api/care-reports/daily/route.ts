import { Prisma } from "@/generated/prisma/client";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import {
  buildDailyCareRows,
  dailyCareRequestHash,
  dailyReportSchema,
} from "@/lib/daily-care-batch";
import {
  studentClassWhere,
  type TeacherScopedAccess,
} from "@/lib/student-access-scope";

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function replayBatch(
  schoolId: string,
  batchId: string,
  hash: string,
  access: TeacherScopedAccess
) {
  const rows = await prisma.careReport.findMany({
    where: {
      schoolId,
      dailyBatchId: batchId,
      student: studentClassWhere(access),
    },
    select: { id: true, studentId: true, dailyBatchHash: true },
  });
  if (rows.length === 0) return null;
  if (rows.some((row) => row.dailyBatchHash !== hash)) {
    return Response.json(
      { error: "استُخدم معرّف الإرسال لمحتوى مختلف", code: "IDEMPOTENCY_CONFLICT" },
      { status: 409 }
    );
  }
  return Response.json({ created: rows.length, replayed: true, reports: rows });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = dailyReportSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const schoolId = session.user.schoolId;
  const payload = parsed.data;
  const hash = dailyCareRequestHash(payload);
  const replay = await replayBatch(schoolId, payload.idempotencyKey, hash, session);
  if (replay) return replay;

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
          ...studentClassWhere(session),
        },
        select: { id: true, classId: true },
      });
      if (students.length !== studentIds.length) throw new Error("INVALID_STUDENT_SET");

      const reports = buildDailyCareRows(
        payload,
        schoolId,
        students,
        { teacherId: session.teacherId, name: session.user.name ?? "الطاقم" }
      );
      if (reports.length === 0) throw new Error("EMPTY_DAILY_REPORT");

      const saved: { id: string; studentId: string }[] = [];
      for (const report of reports) {
        const row = await tx.careReport.create({ data: report, select: { id: true, studentId: true } });
        saved.push(row);
      }
      return saved;
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const concurrentReplay = await replayBatch(schoolId, payload.idempotencyKey, hash, session);
      if (concurrentReplay) return concurrentReplay;
      return Response.json({ error: "دفعة التقرير غير متاحة", code: "BATCH_NOT_AVAILABLE" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "INVALID_STUDENT_SET") {
      return Response.json({ error: "تتضمن القائمة طفلاً غير متاح", code: "INVALID_STUDENT_SET" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "EMPTY_DAILY_REPORT") {
      return Response.json({ error: "أدخلي بياناً واحداً على الأقل", code: "EMPTY_DAILY_REPORT" }, { status: 422 });
    }
    throw error;
  }

  await logAction({
    school_id: schoolId,
    action: `إرسال التقرير اليومي الموحّد للمراجعة لـ${payload.entries.length} طفل`,
    entity_type: "care_report_batch",
    entity_id: payload.idempotencyKey,
    performed_by: session.user.name ?? "الطاقم",
    request,
  });

  return Response.json({ created: created.length, replayed: false, reports: created }, { status: 201 });
}
