import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { parseClassGroup } from "@/lib/enum-labels";
import { resolveStageId, foreignStageResponse } from "@/lib/academic-stage";
import { z } from "zod";
import { assertTeacherOwned, assertClassOwned, crossTenantResponse } from "@/lib/tenant-guard";

const createActivitySchema = z.object({
  name: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  teacherId: z.string().optional(),
  /** DEPRECATED — still accepted so older clients keep working. */
  group: z.string().optional(),
  /** The school's own academic stage (task 2.44). */
  stageId: z.string().nullish(),
  period: z.enum(["MORNING", "EVENING"]).optional(),
  childrenCount: z.number().int().optional(),
  activityFee: z.number().optional(),
  fee: z.number().optional(),
  imageUrl: z.string().nullish(),
  message: z.string().optional(),
  classIds: z.array(z.string()).optional(),
});

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const dateFilter = searchParams.get("dateFilter");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const where: Record<string, unknown> = { schoolId };
  // Auto-archive by date: current = endDate >= today, past = endDate < today
  if (dateFilter === "current") where.endDate = { gte: today };
  if (dateFilter === "past") where.endDate = { lt: today };

  const activities = await prisma.activity.findMany({
    where,
    include: {
      teacher: true,
      stage: { select: { id: true, nameAr: true, nameEn: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  /**
   * `fee` alongside `activityFee`.
   *
   * The client type has always read `fee`; the column is `activityFee`, so the
   * edit form opened showing 0 for an activity that charged 50 — and saving
   * wrote the 0 back. Both names are returned so older readers keep working.
   */
  return Response.json(
    activities.map((activity) => ({ ...activity, fee: activity.activityFee })),
    { status: 200 }
  );
}

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createActivitySchema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    const first = Object.values(fields).flat()[0] ?? "بيانات غير صحيحة";
    return Response.json({ error: first }, { status: 400 });
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
    classIds,
  } = parsed.data;

  /**
   * Every id from the client is proven to belong to this school first.
   *
   * `stageId` was checked here and the other two were not, so a create could
   * point an activity at another tenant's teacher and — worse — invite another
   * tenant's classes. `send` then walks `invite.class.students` and messages
   * those children's guardians, because the *activity* passes the schoolId
   * check while its invitations do not. The update route has guarded all three
   * since it was written; this one never did.
   */
  let ownedStageId: string | null;
  let ownedTeacherId: string | null | undefined;
  const ownedClassIds: string[] = [];
  try {
    ownedStageId = await resolveStageId(stageId, schoolId);
    if (teacherId !== undefined) {
      ownedTeacherId = await assertTeacherOwned(teacherId || null, schoolId);
    }
    for (const classId of classIds ?? []) {
      const owned = await assertClassOwned(classId, schoolId);
      if (owned) ownedClassIds.push(owned);
    }
  } catch (error) {
    const denied = crossTenantResponse(error);
    if (denied) return denied;
    const foreignStage = foreignStageResponse(error);
    if (foreignStage) return foreignStage;
    throw error;
  }

  const resolvedFee = fee ?? activityFee;

  const activity = await prisma.activity.create({
    data: {
      schoolId,
      name,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      ...(ownedTeacherId !== undefined && { teacherId: ownedTeacherId }),
      ...(group !== undefined && { group: parseClassGroup(group) ?? "KG1" }),
      ...(ownedStageId !== null && { stageId: ownedStageId }),
      ...(period !== undefined && { period }),
      ...(childrenCount !== undefined && { childrenCount }),
      ...(resolvedFee !== undefined && { activityFee: resolvedFee }),
      ...(imageUrl !== undefined && { imageUrl }),
      ...(message !== undefined && { message }),
      ...(ownedClassIds.length > 0 && {
        activityInvites: {
          create: ownedClassIds.map((classId) => ({ classId })),
        },
      }),
    },
    include: { teacher: true, activityInvites: { include: { class: true } } },
  });

  await logAction({
    school_id: schoolId,
    action: `إضافة فعالية جديدة: ${activity.name}`,
    entity_type: "activity",
    entity_id: activity.id,
    entity_name: activity.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(activity, { status: 201 });
}
