import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertClassOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { z } from "zod";

export async function GET(
  _request: Request,
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

  const unit = await prisma.unit.findFirst({
    where: { id, schoolId, deletedAt: null },
    include: {
      lessons: { orderBy: { orderIndex: "asc" } },
      classes: { select: { classId: true } },
      // `url` is now a `/api/files/…` path rather than a base64 payload, so it
      // costs nothing to include and is what the link in the UI points at.
      files: {
        select: {
          id: true,
          name: true,
          url: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!unit) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    ...unit,
    classIds: unit.classes.map((link) => link.classId),
    classes: undefined,
  });
}

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  classIds: z.array(z.string()).max(60).optional(),
  /** Task 2.23 / 2.25 — archiving is not deletion. */
  archived: z.boolean().optional(),
});

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

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const existing = await prisma.unit.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if ("description" in parsed.data) data.description = parsed.data.description ?? null;

  const startDate =
    "startDate" in parsed.data
      ? parsed.data.startDate
        ? new Date(parsed.data.startDate)
        : null
      : existing.startDate;
  const endDate =
    "endDate" in parsed.data
      ? parsed.data.endDate
        ? new Date(parsed.data.endDate)
        : null
      : existing.endDate;

  if (
    (startDate && Number.isNaN(startDate.getTime())) ||
    (endDate && Number.isNaN(endDate.getTime()))
  ) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }
  // Validated against the *resolved* pair, so changing one date is checked
  // against the other as it will actually be stored.
  if (startDate && endDate && endDate < startDate) {
    return Response.json(
      { error: "تاريخ النهاية يجب أن يكون بعد البداية" },
      { status: 422 }
    );
  }
  if ("startDate" in parsed.data) data.startDate = startDate;
  if ("endDate" in parsed.data) data.endDate = endDate;

  if (parsed.data.archived !== undefined) {
    data.archivedAt = parsed.data.archived ? new Date() : null;
  }

  let classIds: string[] | null = null;
  try {
    if (parsed.data.classIds !== undefined) {
      const owned: string[] = [];
      for (const classId of parsed.data.classIds) {
        const resolved = await assertClassOwned(classId, schoolId);
        if (resolved) owned.push(resolved);
      }
      classIds = Array.from(new Set(owned));
    }
  } catch (error) {
    const denied = crossTenantResponse(error);
    if (denied) return denied;
    throw error;
  }

  const unit = await prisma.$transaction(async (tx) => {
    if (classIds !== null) {
      await tx.unitClass.deleteMany({ where: { unitId: id } });
      if (classIds.length > 0) {
        await tx.unitClass.createMany({
          data: classIds.map((classId) => ({ unitId: id, classId })),
        });
      }
    }
    return tx.unit.update({
      where: { id },
      data,
      include: { classes: { select: { classId: true } } },
    });
  });

  await logAction({
    school_id: schoolId,
    action:
      parsed.data.archived === true
        ? `أرشفة وحدة: ${unit.name}`
        : parsed.data.archived === false
          ? `إلغاء أرشفة وحدة: ${unit.name}`
          : `تعديل وحدة: ${unit.name}`,
    entity_type: "unit",
    entity_id: unit.id,
    entity_name: unit.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({
    ...unit,
    classIds: unit.classes.map((link) => link.classId),
    classes: undefined,
  });
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

  const existing = await prisma.unit.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, name: true, _count: { select: { events: true } } },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  // Soft delete. Calendar events keep their `unitId` — the FK is ON DELETE SET
  // NULL, so a later hard purge detaches them rather than taking the timetable
  // with it.
  await prisma.unit.update({ where: { id }, data: { deletedAt: new Date() } });

  await logAction({
    school_id: schoolId,
    action: `حذف وحدة: ${existing.name}`,
    entity_type: "unit",
    entity_id: existing.id,
    entity_name: existing.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, linkedEvents: existing._count.events });
}
