import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertTeacherOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { parseClassGroup } from "@/lib/enum-labels";
import { z } from "zod";

const updateClassSchema = z.object({
  name: z.string().min(1).optional(),
  teacherId: z.string().nullish(),
  group: z.string().nullish(),
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
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const cls = await prisma.class.findFirst({
    where: { id, schoolId, deletedAt: null },
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
        select: {
          students: { where: { deletedAt: null, isActive: true } },
        },
      },
    },
  });

  if (!cls) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(cls, { status: 200 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const existing = await prisma.class.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const enrolledStudents = await prisma.student.findMany({
    where: { classId: id, deletedAt: null },
    select: { id: true, name: true },
  });

  await prisma.$transaction([
    prisma.class.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.student.updateMany({
      where: { classId: id, deletedAt: null },
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
