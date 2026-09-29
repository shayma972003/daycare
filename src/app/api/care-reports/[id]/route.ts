import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import {
  careReportInputSchema,
  buildReportFields,
  CARE_TYPE_LABELS,
} from "@/lib/care-reports";
import { studentClassWhere } from "@/lib/student-access-scope";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = careReportInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const existing = await prisma.careReport.findFirst({
    where: {
      id,
      schoolId,
      deletedAt: null,
      student: studentClassWhere(session),
    },
    select: {
      id: true,
      studentId: true,
      dailyBatchId: true,
      reviewStatus: true,
      student: { select: { name: true } },
    },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (existing.dailyBatchId) {
    return Response.json({
      error: "يجب تعديل التقرير اليومي وإعادة إرسال الدفعة كاملة",
      code: "DAILY_BATCH_EDIT_REQUIRED",
    }, { status: 409 });
  }
  if (existing.reviewStatus === "APPROVED") {
    return Response.json({
      error: "لا يمكن تعديل تقرير اعتمده المدير وظهر لولي الأمر",
      code: "APPROVED_REPORT_IMMUTABLE",
    }, { status: 409 });
  }

  // The child cannot be changed by an edit. Moving a report between children is
  // not a correction — it is two actions, and doing it in one silently rewrites
  // what two families were told.
  const fields = buildReportFields({ ...parsed.data, studentId: existing.studentId });
  if (!fields) {
    return Response.json({ error: "لم يتم إدخال أي بيانات" }, { status: 422 });
  }

  const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined;
  if (occurredAt && Number.isNaN(occurredAt.getTime())) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }

  const updated = await prisma.careReport.updateMany({
    where: {
      id,
      schoolId,
      deletedAt: null,
      student: studentClassWhere(session),
    },
    data: {
      type: parsed.data.type,
      ...(occurredAt ? { occurredAt } : {}),
      note: parsed.data.note?.trim() || null,
      photoUrl: parsed.data.photoUrl || null,
      reviewStatus: "PENDING_REVIEW",
      reviewedAt: null,
      reviewedById: null,
      reviewedByName: null,
      reviewNote: null,
      ...fields,
    },
  });
  if (updated.count !== 1) return Response.json({ error: "Not found" }, { status: 404 });
  const report = await prisma.careReport.findUniqueOrThrow({ where: { id } });

  await logAction({
    school_id: schoolId,
    action: `تعديل تقرير ${CARE_TYPE_LABELS[report.type]}: ${existing.student.name}`,
    entity_type: "care_report",
    entity_id: report.id,
    entity_name: existing.student.name,
    performed_by: session.user.name ?? "الطاقم",
    request,
  });

  return Response.json(report);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  const existing = await prisma.careReport.findFirst({
    where: {
      id,
      schoolId,
      deletedAt: null,
      student: studentClassWhere(session),
    },
    select: { id: true, type: true, student: { select: { name: true } } },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  // Soft delete. A parent may already have read it, and the audit trail should
  // show that it was retracted rather than that it never existed.
  const deleted = await prisma.careReport.updateMany({
    where: {
      id,
      schoolId,
      deletedAt: null,
      student: studentClassWhere(session),
    },
    data: { deletedAt: new Date() },
  });
  if (deleted.count !== 1) return Response.json({ error: "Not found" }, { status: 404 });

  await logAction({
    school_id: schoolId,
    action: `حذف تقرير ${CARE_TYPE_LABELS[existing.type]}: ${existing.student.name}`,
    entity_type: "care_report",
    entity_id: existing.id,
    entity_name: existing.student.name,
    performed_by: session.user.name ?? "الطاقم",
    request,
  });

  return Response.json({ success: true });
}
