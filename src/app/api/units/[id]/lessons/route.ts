import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

/**
 * Lessons inside a unit.
 *
 * Nested under the unit because a lesson has no meaning without one — there is
 * no "all lessons" screen, and a top-level route would need the unit id on every
 * call anyway just to prove ownership.
 */

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullish(),
});

export async function POST(
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  // Ownership through the unit — `Lesson` has no `schoolId` of its own, which is
  // why every lesson route starts here.
  const unit = await prisma.unit.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true },
  });
  if (!unit) return Response.json({ error: "Not found" }, { status: 404 });

  // Appended to the end. Taking the current maximum rather than the count means
  // a deleted lesson does not cause the next one to collide with an existing
  // index.
  const last = await prisma.lesson.findFirst({
    where: { unitId: id },
    orderBy: { orderIndex: "desc" },
    select: { orderIndex: true },
  });

  const lesson = await prisma.lesson.create({
    data: {
      unitId: id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      orderIndex: (last?.orderIndex ?? -1) + 1,
    },
  });

  return Response.json(lesson, { status: 201 });
}

const reorderSchema = z.object({
  lessonIds: z.array(z.string().min(1)).min(1).max(200),
});

/**
 * Reorders the whole list in one call.
 *
 * The client sends the sequence it wants rather than a from/to pair: dragging
 * one lesson changes the index of everything between the two positions, and
 * recomputing that server-side from a move is more code and more ways to be
 * wrong than simply accepting the result.
 */
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

  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const unit = await prisma.unit.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true },
  });
  if (!unit) return Response.json({ error: "Not found" }, { status: 404 });

  // Only lessons that genuinely belong to this unit are reordered; an id from
  // another unit is ignored rather than silently re-parented.
  const owned = await prisma.lesson.findMany({
    where: { unitId: id, id: { in: parsed.data.lessonIds } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((lesson) => lesson.id));

  await prisma.$transaction(
    parsed.data.lessonIds
      .filter((lessonId) => ownedIds.has(lessonId))
      .map((lessonId, index) =>
        prisma.lesson.update({ where: { id: lessonId }, data: { orderIndex: index } })
      )
  );

  return Response.json({ reordered: ownedIds.size });
}
