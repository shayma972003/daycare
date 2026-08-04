import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";

const updateSchema = z.object({
  nameAr: z.string().trim().min(1).max(60).optional(),
  nameEn: z.string().trim().max(60).nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  archived: z.boolean().optional(),
});

/**
 * Renaming, reordering and archiving a stage.
 *
 * There is no DELETE, deliberately. A stage children were enrolled in is part of
 * their record — it appears in past reports and in a child's history — and
 * removing it would either orphan those rows or silently rewrite what they say.
 * Archiving takes it out of every picker while everything that used it keeps
 * reading.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;
  const { id } = await params;

  const stage = await prisma.academicStageOption.findFirst({
    where: { id, schoolId },
    select: { id: true, nameAr: true },
  });
  if (!stage) return Response.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  }

  // The unique index would raise a driver error; this answers in the language
  // the person is reading.
  if (parsed.data.nameAr && parsed.data.nameAr !== stage.nameAr) {
    const clash = await prisma.academicStageOption.findFirst({
      where: { schoolId, nameAr: parsed.data.nameAr, id: { not: id } },
      select: { id: true },
    });
    if (clash) return Response.json({ error: "الاسم مستخدم بالفعل" }, { status: 409 });
  }

  const updated = await prisma.academicStageOption.update({
    where: { id },
    data: {
      ...(parsed.data.nameAr !== undefined && { nameAr: parsed.data.nameAr }),
      ...(parsed.data.nameEn !== undefined && { nameEn: parsed.data.nameEn?.trim() || null }),
      ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
      ...(parsed.data.archived !== undefined && {
        archivedAt: parsed.data.archived ? new Date() : null,
      }),
    },
  });

  await logAction({
    school_id: schoolId,
    action:
      parsed.data.archived === true
        ? `أرشفة مرحلة دراسية: ${updated.nameAr}`
        : parsed.data.archived === false
          ? `إلغاء أرشفة مرحلة دراسية: ${updated.nameAr}`
          : `تعديل مرحلة دراسية: ${updated.nameAr}`,
    entity_type: "academic_stage",
    entity_id: updated.id,
    entity_name: updated.nameAr,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(updated);
}
