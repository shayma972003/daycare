import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { astDateOnly } from "@/lib/datetime";
import { z } from "zod";

/**
 * Staff rota (task 2.28).
 *
 * Returns a week at a time for the same reason the attendance grid does: the
 * screen needs every cell at once, and seven requests fill it in raggedly.
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

  const startParam = new URL(request.url).searchParams.get("start");
  const anchor = startParam ? new Date(startParam) : new Date();
  if (Number.isNaN(anchor.getTime())) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }

  // Sunday-first, matching the working week and the attendance grid.
  const weekStart = astDateOnly(anchor);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const [teachers, shifts] = await Promise.all([
    prisma.teacher.findMany({
      // Departed staff are excluded: `status != ACTIVE` is what "archived" means
      // for people, since they carry the retention lifecycle rather than an
      // `archivedAt` column. See the note in the migration.
      where: { schoolId, deletedAt: null, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, period: true },
    }),
    prisma.shift.findMany({
      where: { schoolId, date: { gte: weekStart, lt: weekEnd } },
      select: {
        id: true,
        teacherId: true,
        date: true,
        startTime: true,
        endTime: true,
        role: true,
        notes: true,
      },
    }),
  ]);

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });

  return Response.json({
    weekStart: weekStart.toISOString().slice(0, 10),
    days,
    teachers,
    shifts: shifts.map((shift) => ({
      ...shift,
      date: shift.date.toISOString().slice(0, 10),
    })),
  });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const upsertSchema = z.object({
  teacherId: z.string().min(1),
  date: z.string().min(1),
  // Wall clock, matching how School stores its hours.
  startTime: z.string().regex(HHMM, "الوقت يجب أن يكون بصيغة HH:mm"),
  endTime: z.string().regex(HHMM, "الوقت يجب أن يكون بصيغة HH:mm"),
  role: z.string().max(80).nullish(),
  notes: z.string().max(300).nullish(),
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

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  // A shift that ends before it starts is almost always a typo, and storing it
  // makes every hours calculation downstream negative.
  if (parsed.data.endTime <= parsed.data.startTime) {
    return Response.json(
      { error: "وقت النهاية يجب أن يكون بعد البداية" },
      { status: 422 }
    );
  }

  const teacher = await prisma.teacher.findFirst({
    where: { id: parsed.data.teacherId, schoolId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!teacher) return Response.json({ error: "المعلم غير موجود" }, { status: 404 });

  const date = new Date(parsed.data.date);
  if (Number.isNaN(date.getTime())) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }

  // Upsert on the unique (teacher, date): editing a cell in the rota grid and
  // creating one are the same gesture to whoever is filling it in.
  const shift = await prisma.shift.upsert({
    where: { teacherId_date: { teacherId: teacher.id, date: astDateOnly(date) } },
    create: {
      schoolId,
      teacherId: teacher.id,
      date: astDateOnly(date),
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      role: parsed.data.role ?? null,
      notes: parsed.data.notes ?? null,
    },
    update: {
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      role: parsed.data.role ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  await logAction({
    school_id: schoolId,
    action: `تحديد مناوبة ${teacher.name}: ${parsed.data.startTime}–${parsed.data.endTime}`,
    entity_type: "shift",
    entity_id: shift.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ ...shift, date: shift.date.toISOString().slice(0, 10) });
}

const deleteSchema = z.object({
  teacherId: z.string().min(1),
  date: z.string().min(1),
});

export async function DELETE(request: Request) {
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

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const date = new Date(parsed.data.date);
  if (Number.isNaN(date.getTime())) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }

  const { count } = await prisma.shift.deleteMany({
    where: { schoolId, teacherId: parsed.data.teacherId, date: astDateOnly(date) },
  });

  return Response.json({ deleted: count });
}
