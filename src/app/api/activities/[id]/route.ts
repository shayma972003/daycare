import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { parseClassGroup } from "@/lib/enum-labels";
import { resolveStageId, foreignStageResponse } from "@/lib/academic-stage";
import { assertTeacherOwned, assertClassOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { z } from "zod";

const updateActivitySchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  // Empty string means "no teacher" — the form sends it for an unset select, and
  // it used to be written straight through as a foreign key.
  teacherId: z.string().nullable().optional(),
  /** DEPRECATED — still accepted so older clients keep working. */
  group: z.string().optional(),
  /** The school's own academic stage (task 2.44). */
  stageId: z.string().nullish(),
  period: z.enum(["MORNING", "EVENING"]).optional(),
  childrenCount: z.number().int().optional(),
  activityFee: z.number().optional(),
  // The create route accepts both spellings; this one only knew `activityFee`,
  // so the fee typed into the edit form was validated, ignored, and lost.
  fee: z.number().optional(),
  imageUrl: z.string().nullish(),
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
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
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
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
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
    stageId,
    period,
    childrenCount,
    activityFee,
    fee,
    imageUrl,
    message,
    isActive,
    classIds,
  } = parsed.data;

  // Both ids arrive from the client and were written without any check, so an
  // activity could be pointed at another tenant's teacher and — worse — invite
  // another tenant's classes, whose guardians would then be notified.
  let ownedTeacherId: string | null | undefined;
  let ownedClassIds: string[] | undefined;
  // `undefined` means the client did not mention it; `null` means clear it.
  let ownedStageId: string | null | undefined;
  try {
    if (teacherId !== undefined) {
      ownedTeacherId = await assertTeacherOwned(teacherId || null, schoolId);
    }
    if (classIds !== undefined) {
      ownedClassIds = [];
      for (const classId of classIds) {
        const owned = await assertClassOwned(classId, schoolId);
        if (owned) ownedClassIds.push(owned);
      }
    }
    if (stageId !== undefined) {
      ownedStageId = await resolveStageId(stageId, schoolId);
    }
  } catch (error) {
    const denied = crossTenantResponse(error);
    if (denied) return denied;
    const foreignStage = foreignStageResponse(error);
    if (foreignStage) return foreignStage;
    throw error;
  }

  if (ownedClassIds !== undefined) {
    await prisma.activityInvite.deleteMany({ where: { activityId: id } });
  }

  const resolvedFee = activityFee ?? fee;

  const activity = await prisma.activity.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
      ...(teacherId !== undefined && { teacherId: ownedTeacherId ?? null }),
      ...(group !== undefined && { group: parseClassGroup(group) ?? "KG1" }),
      ...(ownedStageId !== undefined && { stageId: ownedStageId }),
      ...(period !== undefined && { period }),
      ...(childrenCount !== undefined && { childrenCount }),
      ...(resolvedFee !== undefined && { activityFee: resolvedFee }),
      ...(imageUrl !== undefined && { imageUrl: imageUrl ?? null }),
      ...(message !== undefined && { message }),
      ...(isActive !== undefined && { isActive }),
      ...(ownedClassIds !== undefined && ownedClassIds.length > 0 && {
        activityInvites: {
          create: ownedClassIds.map((classId) => ({ classId })),
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
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
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
