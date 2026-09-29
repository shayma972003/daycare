import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertTeachersOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { assertClassCapacity, planLimitResponse } from "@/lib/plan-limits";
import { parseClassGroup } from "@/lib/enum-labels";
import { z } from "zod";
import { classIdWhere } from "@/lib/student-access-scope";

const createClassSchema = z.object({
  name: z.string().min(1),
  teacherIds: z.array(z.string().min(1)).max(50).optional(),
  /** DEPRECATED — accepted for older clients and promoted to `teacherIds`. */
  teacherId: z.string().optional(),
  /** DEPRECATED — still accepted so older clients keep working. */
  group: z.string().optional(),
  /** The school's own academic stage (task 2.44). */
  stageId: z.string().optional(),
  period: z.enum(["MORNING", "EVENING"]).optional(),
  registrationDate: z.string().optional(),
  notes: z.string().optional(),
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
  const period = searchParams.get("period");
  const group = searchParams.get("group");
  const stageId = searchParams.get("stageId");

  const where: Record<string, unknown> = {
    schoolId,
    deletedAt: null,
    ...classIdWhere(session),
  };

  if (period) {
    where.period = period;
  }
  if (group) {
    where.group = group;
  }
  // The stage filter supersedes `group`; both are accepted while older
  // clients are still in the wild.
  if (stageId) {
    where.stageId = stageId;
  }

  const classes = await prisma.class.findMany({
    where,
    select: {
      id: true,
      name: true,
      group: true,
      stage: { select: { id: true, nameAr: true, nameEn: true } },
      period: true,
      registrationDate: true,
      notes: true,
      teacherId: true,
      teacher: { select: { id: true, name: true } },
      teacherAssignments: {
        select: { teacher: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
      needsTeacherWarning: true,
      // Only ids are needed for the list's student count — full student rows
      // (with base64 avatar/evaluation blobs) are never needed here.
      students: { where: { deletedAt: null }, select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  return Response.json(classes.map(({ teacherAssignments, ...room }) => ({
    ...room,
    teachers: teacherAssignments.map((assignment) => assignment.teacher),
    needsTeacherWarning: teacherAssignments.length === 0,
  })), { status: 200 });
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

  const parsed = createClassSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { name, teacherId, teacherIds, group, stageId, period, registrationDate, notes } = parsed.data;

  // Proven to belong to this school before it is stored: the id comes from the
  // client, and a room pointing at another tenant's stage would render that
  // tenant's wording on this school's screens.
  let ownedStageId: string | null = null;
  if (stageId) {
    const stage = await prisma.academicStageOption.findFirst({
      where: { id: stageId, schoolId },
      select: { id: true },
    });
    if (!stage) {
      return Response.json({ error: "المرحلة الدراسية غير صالحة" }, { status: 422 });
    }
    ownedStageId = stage.id;
  }

  // Unchecked, this let a class be assigned another school's teacher — and the
  // list query includes `teacher: { name }`, leaking it straight back out.
  let ownedTeacherIds: string[];
  try {
    await assertClassCapacity(schoolId);
    ownedTeacherIds = await assertTeachersOwned(
      teacherIds ?? (teacherId ? [teacherId] : []),
      schoolId
    );
  } catch (error) {
    const overLimit = planLimitResponse(error);
    if (overLimit) return overLimit;
    const denied = crossTenantResponse(error);
    if (denied) return denied;
    throw error;
  }

  // Create the room first, then its tenant-scoped assignment rows. Mixing
  // scalar relation ids (`schoolId`, `teacherId`) with a nested relation create
  // makes Prisma select the checked input shape, where those scalar ids are not
  // accepted at runtime. Keeping both writes in one transaction also prevents a
  // room from being committed without the teachers the manager selected.
  const cls = await prisma.$transaction(async (tx) => {
    const created = await tx.class.create({
      data: {
        schoolId,
        name,
        teacherId: ownedTeacherIds[0] ?? null,
        needsTeacherWarning: ownedTeacherIds.length === 0,
        ...(group !== undefined && { group: parseClassGroup(group) ?? "KG1" }),
        ...(ownedStageId !== null && { stageId: ownedStageId }),
        ...(period !== undefined && { period }),
        ...(registrationDate !== undefined && { registrationDate: new Date(registrationDate) }),
        ...(notes !== undefined && { notes }),
      },
      select: { id: true },
    });

    if (ownedTeacherIds.length > 0) {
      await tx.classTeacher.createMany({
        data: ownedTeacherIds.map((teacherId) => ({
          classId: created.id,
          schoolId,
          teacherId,
        })),
      });
    }

    return tx.class.findFirstOrThrow({
      where: { id: created.id, schoolId },
      include: {
        teacher: { select: { id: true, name: true } },
        teacherAssignments: {
          select: { teacher: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
        students: true,
      },
    });
  });

  await logAction({
    school_id: schoolId,
    action: `إضافة فصل جديد: ${cls.name}`,
    entity_type: "class",
    entity_id: cls.id,
    entity_name: cls.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  const { teacherAssignments, ...classData } = cls;
  return Response.json({
    ...classData,
    teachers: teacherAssignments.map((assignment) => assignment.teacher),
  }, { status: 201 });
}
