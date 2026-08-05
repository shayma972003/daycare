import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { grants } from "@/lib/permissions";

/**
 * Search across the school, for the command palette.
 *
 * This is the one endpoint in the product that queries several tables from a
 * free-text string, which makes it the easiest place to leak across tenants. Two
 * rules hold it shut:
 *
 * 1. **`schoolId` is on every `where`, not on some of them.** Prisma treats
 *    `where: { schoolId: undefined }` as no filter at all, so a missing claim
 *    would not error — it would return the other nurseries' children. The id
 *    comes from `requireSession()`, which proves the claim before this line runs.
 * 2. **Each table is searched only if the caller may read that table.** A
 *    permission check on the palette's *display* is a courtesy; here it is the
 *    control. Without it an accountant — who has `students.view` but no
 *    `staff.view` — could type a name and learn the payroll list.
 *
 * Results are capped and deliberately thin: a name, an id and a link. The
 * palette is a way to *reach* a record, not a way to read one, so nothing here
 * needs to carry a phone number or a health note.
 */

const LIMIT = 6;

export async function GET(request: Request) {
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
  const held = session.permissions;
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();

  // Two characters is the floor: one letter matches most of the roster and
  // makes the palette feel broken rather than fast.
  if (query.length < 2) return Response.json({ results: [] });

  const contains = { contains: query, mode: "insensitive" as const };

  const [students, teachers, classes] = await Promise.all([
    grants(held, "students.view")
      ? prisma.student.findMany({
          where: { schoolId, isActive: true, name: contains },
          select: { id: true, name: true },
          take: LIMIT,
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),

    grants(held, "staff.view")
      ? prisma.teacher.findMany({
          where: { schoolId, deletedAt: null, name: contains },
          select: { id: true, name: true },
          take: LIMIT,
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),

    grants(held, "classes.view")
      ? prisma.class.findMany({
          where: { schoolId, deletedAt: null, name: contains },
          select: { id: true, name: true },
          take: LIMIT,
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return Response.json({
    results: [
      ...students.map((row) => ({ kind: "student", id: row.id, label: row.name, href: `/students/${row.id}` })),
      ...teachers.map((row) => ({ kind: "teacher", id: row.id, label: row.name, href: `/teachers/${row.id}` })),
      ...classes.map((row) => ({ kind: "class", id: row.id, label: row.name, href: `/classes/${row.id}` })),
    ],
  });
}
