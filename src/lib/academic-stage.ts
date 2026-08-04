import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Proves a stage id belongs to the caller's school (task 2.44).
 *
 * Every route that accepts one gets it from a client, and an unchecked id lets a
 * room, a child or an activity be filed under another tenant's stage — after
 * which this school's own screens render that tenant's wording.
 *
 * One implementation rather than the same six lines in five routes: the check is
 * easy to write slightly differently each time, and the version that forgets the
 * `schoolId` still passes every test that does not specifically look for it.
 */
export class ForeignStageError extends Error {
  constructor() {
    super("المرحلة الدراسية غير صالحة");
    this.name = "ForeignStageError";
  }
}

/**
 * Returns the id when it is this school's, `null` when nothing was sent.
 *
 * Throws rather than returning a sentinel so a caller cannot accidentally treat
 * "not ours" as "none given" and write `null` where the client asked for
 * something specific.
 */
export async function resolveStageId(
  stageId: string | null | undefined,
  schoolId: string
): Promise<string | null> {
  if (!stageId) return null;

  const stage = await prisma.academicStageOption.findFirst({
    where: { id: stageId, schoolId },
    select: { id: true },
  });
  if (!stage) throw new ForeignStageError();

  return stage.id;
}

/** The 422 a route should answer with, or null when the error is something else. */
export function foreignStageResponse(error: unknown): Response | null {
  if (error instanceof ForeignStageError) {
    return Response.json({ error: error.message }, { status: 422 });
  }
  return null;
}
