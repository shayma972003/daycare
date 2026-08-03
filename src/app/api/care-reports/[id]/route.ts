import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import {
  careReportInputSchema,
  buildReportFields,
  CARE_TYPE_LABELS,
} from "@/lib/care-reports";

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
    where: { id, schoolId, deletedAt: null },
    select: { id: true, studentId: true, student: { select: { name: true } } },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

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

  const report = await prisma.careReport.update({
    where: { id },
    data: {
      type: parsed.data.type,
      ...(occurredAt ? { occurredAt } : {}),
      note: parsed.data.note?.trim() || null,
      photoUrl: parsed.data.photoUrl || null,
      ...fields,
    },
  });

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
    where: { id, schoolId, deletedAt: null },
    select: { id: true, type: true, student: { select: { name: true } } },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  // Soft delete. A parent may already have read it, and the audit trail should
  // show that it was retracted rather than that it never existed.
  await prisma.careReport.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

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
