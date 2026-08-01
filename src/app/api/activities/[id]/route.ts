import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { parseClassGroup } from "@/lib/enum-labels";
import { z } from "zod";

const updateActivitySchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  teacherId: z.string().nullable().optional(),
  group: z.string().optional(),
  period: z.enum(["MORNING", "EVENING"]).optional(),
  childrenCount: z.number().int().optional(),
  activityFee: z.number().optional(),
  message: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  classIds: z.array(z.string()).optional(),
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

  const activity = await prisma.activity.findFirst({
    where: { id, schoolId },
    include: {
      teacher: true,
      activityInvites: { include: { class: true } },
    },
  });

  if (!activity) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(activity, { status: 200 });
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

  const existing = await prisma.activity.findFirst({ where: { id, schoolId } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateActivitySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    name,
    startDate,
    endDate,
    teacherId,
    group,
    period,
    childrenCount,
    activityFee,
    message,
    isActive,
    classIds,
  } = parsed.data;

  if (classIds !== undefined) {
    await prisma.activityInvite.deleteMany({ where: { activityId: id } });
  }

  const activity = await prisma.activity.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
      ...(teacherId !== undefined && { teacherId: teacherId ?? null }),
      ...(group !== undefined && { group: parseClassGroup(group) ?? "KG1" }),
      ...(period !== undefined && { period }),
      ...(childrenCount !== undefined && { childrenCount }),
      ...(activityFee !== undefined && { activityFee }),
      ...(message !== undefined && { message }),
      ...(isActive !== undefined && { isActive }),
      ...(classIds !== undefined && classIds.length > 0 && {
        activityInvites: {
          create: classIds.map((classId) => ({ classId })),
        },
      }),
    },
    include: {
      teacher: true,
      activityInvites: { include: { class: true } },
    },
  });

  await logAction({
    school_id: schoolId,
    action: `تعديل فعالية: ${activity.name}`,
    entity_type: "activity",
    entity_id: activity.id,
    entity_name: activity.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(activity, { status: 200 });
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

  const existing = await prisma.activity.findFirst({ where: { id, schoolId } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.activity.delete({ where: { id } });

  await logAction({
    school_id: schoolId,
    action: `حذف فعالية: ${existing.name}`,
    entity_type: "activity",
    entity_id: existing.id,
    entity_name: existing.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
