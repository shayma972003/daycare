import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertClassOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { z } from "zod";

/**
 * Teaching units (tasks 2.22–2.24).
 *
 * The list deliberately does **not** include `files`: attachments are base64
 * payloads until R2 lands, and joining them here would make listing twelve units
 * a multi-megabyte response. They are fetched when a unit is opened.
 */
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
  const url = new URL(request.url);

  // active | archived | all
  const status = url.searchParams.get("status") ?? "active";
  const search = url.searchParams.get("search")?.trim();
  const sort = url.searchParams.get("sort") === "oldest" ? "asc" : "desc";

  const units = await prisma.unit.findMany({
    where: {
      schoolId,
      deletedAt: null,
      ...(status === "active" ? { archivedAt: null } : {}),
      ...(status === "archived" ? { archivedAt: { not: null } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: sort },
    select: {
      id: true,
      name: true,
      description: true,
      startDate: true,
      endDate: true,
      archivedAt: true,
      createdAt: true,
      classes: { select: { classId: true } },
      _count: { select: { lessons: true, files: true } },
    },
  });

  return Response.json(
    units.map((unit) => ({
      ...unit,
      classIds: unit.classes.map((link) => link.classId),
      classes: undefined,
      lessonCount: unit._count.lessons,
      fileCount: unit._count.files,
      _count: undefined,
    }))
  );
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  classIds: z.array(z.string()).max(60).optional(),
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
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : null;
  const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  if (
    (startDate && Number.isNaN(startDate.getTime())) ||
    (endDate && Number.isNaN(endDate.getTime()))
  ) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }
  if (startDate && endDate && endDate < startDate) {
    return Response.json(
      { error: "تاريخ النهاية يجب أن يكون بعد البداية" },
      { status: 422 }
    );
  }

  let classIds: string[] = [];
  try {
    for (const classId of parsed.data.classIds ?? []) {
      const owned = await assertClassOwned(classId, schoolId);
      if (owned) classIds.push(owned);
    }
  } catch (error) {
    const denied = crossTenantResponse(error);
    if (denied) return denied;
    throw error;
  }
  classIds = Array.from(new Set(classIds));

  const unit = await prisma.unit.create({
    data: {
      schoolId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      startDate,
      endDate,
      ...(classIds.length > 0
        ? { classes: { create: classIds.map((classId) => ({ classId })) } }
        : {}),
    },
    include: { classes: { select: { classId: true } } },
  });

  await logAction({
    school_id: schoolId,
    action: `إنشاء وحدة تعليمية: ${unit.name}`,
    entity_type: "unit",
    entity_id: unit.id,
    entity_name: unit.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(
    { ...unit, classIds: unit.classes.map((link) => link.classId), classes: undefined },
    { status: 201 }
  );
}
