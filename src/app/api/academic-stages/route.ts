import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";

/**
 * The school's academic stages (task 2.44).
 *
 * Replaces two frozen enums that held the same four values under two names —
 * `AcademicStage` on the child, `ClassGroup` on the room — each with its own
 * Arabic labels, which is why one screen said "المجموعة" and another said
 * "المرحلة الدراسية". A school running a pre-KG room, or a fourth year, had
 * nowhere to record it.
 *
 * Reading is open to any signed-in member: the stage appears in nearly every
 * picker in the product, and a teacher who cannot read the list sees empty
 * dropdowns. Changing it needs `settings.manage`.
 */
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
  const schoolId = session.user.schoolId;

  // Archived stages are still returned when asked for, because a filter over
  // historical records has to be able to name one.
  const includeArchived =
    new URL(request.url).searchParams.get("includeArchived") === "1";

  const stages = await prisma.academicStageOption.findMany({
    where: { schoolId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
    select: {
      id: true,
      nameAr: true,
      nameEn: true,
      sortOrder: true,
      isSystem: true,
      archivedAt: true,
      _count: { select: { classes: true, students: true } },
    },
  });

  return Response.json(
    stages.map((stage) => ({
      ...stage,
      classCount: stage._count.classes,
      studentCount: stage._count.students,
      _count: undefined,
    }))
  );
}

const createSchema = z.object({
  nameAr: z.string().trim().min(1, "الاسم مطلوب").max(60),
  nameEn: z.string().trim().max(60).nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 422 }
    );
  }

  const existing = await prisma.academicStageOption.findFirst({
    where: { schoolId, nameAr: parsed.data.nameAr },
    select: { id: true, archivedAt: true },
  });

  if (existing) {
    // Re-adding a name that was archived restores it rather than refusing.
    // Refusing would be technically correct and useless: the school is asking
    // for a stage by that name, and one exists.
    if (existing.archivedAt) {
      const restored = await prisma.academicStageOption.update({
        where: { id: existing.id },
        data: { archivedAt: null, nameEn: parsed.data.nameEn ?? undefined },
      });
      return Response.json(restored, { status: 200 });
    }
    return Response.json({ error: "المرحلة موجودة بالفعل" }, { status: 409 });
  }

  // Appended to the end unless placed explicitly — stages are a sequence, and a
  // new one is usually the newest.
  const last = await prisma.academicStageOption.findFirst({
    where: { schoolId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const stage = await prisma.academicStageOption.create({
    data: {
      schoolId,
      nameAr: parsed.data.nameAr,
      nameEn: parsed.data.nameEn?.trim() || null,
      sortOrder: parsed.data.sortOrder ?? (last?.sortOrder ?? -1) + 1,
    },
  });

  await logAction({
    school_id: schoolId,
    action: `إضافة مرحلة دراسية: ${stage.nameAr}`,
    entity_type: "academic_stage",
    entity_id: stage.id,
    entity_name: stage.nameAr,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(stage, { status: 201 });
}
