import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { astDayStart, astDayEnd } from "@/lib/datetime";
import {
  careReportInputSchema,
  buildReportFields,
  describeReport,
  CARE_TYPE_LABELS,
  CARE_REPORT_TYPES,
  type CareReportInput,
} from "@/lib/care-reports";
import { keyFromUrl, schoolIdFromKey } from "@/lib/r2";
import { notifyGuardiansOfReport } from "@/lib/care-report-notify";
import { z } from "zod";

/**
 * Daily care reports (tasks 2.1–2.4).
 *
 * The most-used write path in the product once it ships: a teacher files these
 * between other tasks, dozens of times a day, on a phone.
 */

/** Bounded so one request cannot walk the whole history. */
const MAX_PAGE = 200;

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;
  const url = new URL(request.url);

  const studentId = url.searchParams.get("studentId");
  const classId = url.searchParams.get("classId");
  const type = url.searchParams.get("type");
  const date = url.searchParams.get("date");

  // Day boundaries in AST, not UTC. A report filed at 01:00 Riyadh time belongs
  // to that day; UTC arithmetic files it under yesterday and it vanishes from
  // the parent's view.
  const day = date ? new Date(date) : null;
  const validDay = day && !Number.isNaN(day.getTime()) ? day : null;

  const reports = await prisma.careReport.findMany({
    where: {
      schoolId,
      deletedAt: null,
      ...(studentId ? { studentId } : {}),
      ...(classId ? { classId } : {}),
      ...(type && (CARE_REPORT_TYPES as string[]).includes(type)
        ? { type: type as (typeof CARE_REPORT_TYPES)[number] }
        : {}),
      ...(validDay
        ? { occurredAt: { gte: astDayStart(validDay), lt: astDayEnd(validDay) } }
        : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: MAX_PAGE,
    include: { student: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return Response.json(
    reports.map((report) => ({
      ...report,
      typeLabel: CARE_TYPE_LABELS[report.type],
      summary: describeReport(report),
    }))
  );
}

/**
 * Accepts one report or a batch.
 *
 * Batch is task 2.4 and is not a convenience: "the whole room napped from 12:30
 * to 14:00" is a single observation about fifteen children, and asking a teacher
 * to type it fifteen times guarantees it gets typed zero times.
 */
const bodySchema = z.union([
  careReportInputSchema,
  z.object({
    studentIds: z.array(z.string().min(1)).min(1).max(60),
    report: careReportInputSchema.omit({ studentId: true }),
  }),
]);

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  // Narrowed with an explicit branch rather than a boolean flag: TypeScript does
  // not carry a discriminant check through an intermediate variable.
  const payload = parsed.data;
  const isBatch = "studentIds" in payload;
  const studentIds = "studentIds" in payload ? payload.studentIds : [payload.studentId];
  const template: CareReportInput =
    "studentIds" in payload ? { ...payload.report, studentId: "" } : payload;

  // Every id proven to belong to this school before anything is written — the
  // list comes from the client, and a report filed against another tenant's
  // child would be visible to that family.
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds }, schoolId, deletedAt: null },
    select: { id: true, name: true, classId: true, anonymizedAt: true },
  });

  if (students.length === 0) {
    return Response.json({ error: "لا يوجد أطفال صالحون" }, { status: 404 });
  }

  // A record whose personal data has already been destroyed must not gain new
  // personal data. See docs/DATA_LIFECYCLE.md.
  const writable = students.filter((student) => !student.anonymizedAt);
  if (writable.length === 0) {
    return Response.json(
      { error: "السجلات مجهَّلة ولا يمكن إضافة تقارير لها" },
      { status: 409 }
    );
  }

  /**
   * The photo URL arrives from the client, so it is checked, not trusted.
   *
   * `/api/care-reports/photo` returns a key inside this school's prefix, but
   * nothing stops a caller posting a different one. Without this a report could
   * be made to point at another tenant's object — unreadable to this school's
   * staff, but a cross-tenant reference sitting in the database all the same.
   */
  if (template.photoUrl) {
    const key = keyFromUrl(template.photoUrl);
    if (!key || schoolIdFromKey(key) !== schoolId) {
      return Response.json({ error: "رابط الصورة غير صالح" }, { status: 422 });
    }
  }

  const occurredAt = template.occurredAt ? new Date(template.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }

  const created: { id: string; studentId: string }[] = [];

  for (const student of writable) {
    const fields = buildReportFields({ ...template, studentId: student.id });
    // Nothing was filled in. Skipped rather than saved: a parent seeing an empty
    // "meal" entry assumes something was meant by it.
    if (!fields) continue;

    const report = await prisma.careReport.create({
      data: {
        schoolId,
        studentId: student.id,
        classId: student.classId,
        teacherId: session.teacherId,
        // Snapshot: the report must still say who filed it after that staff
        // member leaves and their record is anonymised.
        reportedByName: session.user.name ?? "الطاقم",
        type: template.type,
        occurredAt,
        note: template.note?.trim() || null,
        photoUrl: template.photoUrl || null,
        ...fields,
      },
      select: { id: true, studentId: true },
    });
    created.push(report);
  }

  if (created.length === 0) {
    return Response.json({ error: "لم يتم إدخال أي بيانات" }, { status: 422 });
  }

  // Fire-and-forget. A push provider outage must not fail the teacher's tap —
  // the report is already saved, and the queue retries on its own schedule.
  void notifyGuardiansOfReport(
    schoolId,
    created.map((report) => report.id)
  ).catch((error) => console.error("[care-reports] notify failed:", error));

  await logAction({
    school_id: schoolId,
    action: isBatch
      ? `تسجيل ${CARE_TYPE_LABELS[template.type]} لـ${created.length} طفل`
      : `تسجيل ${CARE_TYPE_LABELS[template.type]}: ${writable[0].name}`,
    entity_type: "care_report",
    entity_id: created[0].id,
    entity_name: writable[0].name,
    performed_by: session.user.name ?? "الطاقم",
    request,
  });

  return Response.json(
    { created: created.length, skipped: writable.length - created.length, reports: created },
    { status: 201 }
  );
}
