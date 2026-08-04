import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertTeacherOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { parseClassGroup } from "@/lib/enum-labels";
import { resolveStageId, foreignStageResponse } from "@/lib/academic-stage";
import { capacityState } from "@/lib/attendance-schedule";
import { z } from "zod";

const updateClassSchema = z.object({
  name: z.string().min(1).optional(),
  teacherId: z.string().nullish(),
  /** DEPRECATED — still accepted so older clients keep working. */
  group: z.string().nullish(),
  /** The school's own academic stage (task 2.44). */
  stageId: z.string().nullish(),
  /** Infant age bands (task 2.9). Several per room — see the schema comment. */
  ageGroups: z
    .array(z.enum(["AGE_0_6M", "AGE_6_12M", "AGE_1_2Y", "AGE_2_3Y", "AGE_3_4Y"]))
    .optional(),
  /** Null clears the limit; 0 means the room is closed (task 2.10). */
  capacity: z.number().int().min(0).max(500).nullish(),
  /** Archiving — distinct from the trash (task 2.25). */
  archived: z.boolean().optional(),
  period: z.enum(["MORNING", "EVENING"]).nullish(),
  registrationDate: z.string().nullish(),
  notes: z.string().nullish(),
  imageUrl: z.string().nullish(),
});

export async function GET(
  _request: Request,
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
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const cls = await prisma.class.findFirst({
    where: { id, schoolId, deletedAt: null },
    include: {
      teacher: { select: { id: true, name: true } },
      stage: { select: { id: true, nameAr: true, nameEn: true } },
      students: {
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          period: true,
          guardian: { select: { name: true, phone1: true } },
        },
        orderBy: { name: "asc" },
      },
      _count: {
        select: {
          students: { where: { deletedAt: null, isActive: true } },
        },
      },
    },
  });

  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Capacity resolved server-side so every screen reports "over" the same way.
  return Response.json(
    { ...cls, capacityState: capacityState(cls._count.students, cls.capacity) },
    { status: 200 }
  );
}

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
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateClassSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) updateData.name = data.name;
  if ("teacherId" in data) {
    try {
      updateData.teacherId = await assertTeacherOwned(data.teacherId, schoolId);
    } catch (error) {
      const denied = crossTenantResponse(error);
      if (denied) return denied;
      throw error;
    }
    if (updateData.teacherId) updateData.needsTeacherWarning = false;
  }
  if ("group" in data) updateData.group = parseClassGroup(data.group) ?? "KG1";
  if ("stageId" in data) {
    try {
      updateData.stageId = await resolveStageId(data.stageId, schoolId);
    } catch (error) {
      const foreignStage = foreignStageResponse(error);
      if (foreignStage) return foreignStage;
      throw error;
    }
  }
  if (data.ageGroups !== undefined) updateData.ageGroups = data.ageGroups;
  // `null` clears the limit, `0` closes the room — two different intents, so
  // the presence of the key matters and not just its truthiness.
  if ("capacity" in data) updateData.capacity = data.capacity ?? null;
  if (data.archived !== undefined) {
    updateData.archivedAt = data.archived ? new Date() : null;
  }
  if ("period" in data) updateData.period = data.period ?? null;
  if ("registrationDate" in data) {
    updateData.registrationDate = data.registrationDate ? new Date(data.registrationDate) : null;
  }
  if ("notes" in data) updateData.notes = data.notes ?? null;
  if ("imageUrl" in data) updateData.imageUrl = data.imageUrl ?? null;

  const existing = await prisma.class.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const cls = await prisma.class.update({
    where: { id },
    data: updateData,
    include: {
      teacher: { select: { id: true, name: true } },
      students: {
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          period: true,
          guardian: { select: { name: true, phone1: true } },
        },
        orderBy: { name: "asc" },
      },
      _count: {
        select: { students: { where: { deletedAt: null, isActive: true } } },
      },
    },
  });

  await logAction({
    school_id: schoolId,
    action: "تم تعديل بيانات الفصل",
    entity_type: "class",
    entity_id: cls.id,
    entity_name: cls.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(cls, { status: 200 });
}

export async function DELETE(
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
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const existing = await prisma.class.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // `schoolId` on both secondary queries. The class was already proven to belong
  // to this tenant, so these filters are redundant today — that is the point:
  // they are the layer that still holds if the ownership check above is ever
  // moved, weakened, or skipped by a new code path.
  const enrolledStudents = await prisma.student.findMany({
    where: { classId: id, schoolId, deletedAt: null },
    select: { id: true, name: true },
  });

  await prisma.$transaction([
    prisma.class.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.student.updateMany({
      where: { classId: id, schoolId, deletedAt: null },
      data: { classId: null, needsClassWarning: true },
    }),
  ]);

  await logAction({
    school_id: schoolId,
    action: `تم نقل الفصل "${existing.name}" إلى سلة المحذوفات`,
    entity_type: "class",
    entity_id: existing.id,
    entity_name: existing.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, enrolledStudents });
}
