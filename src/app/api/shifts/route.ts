import { Prisma } from "@/generated/prisma/client";
import { logAction } from "@/lib/activity-logger";
import { withNoStore } from "@/lib/auth-response";
import { astDateOnly } from "@/lib/datetime";
import { calendarToday, deviceWeekStart, requestTimeZone } from "@/lib/device-date";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const shiftFields = z.object({
  teacherId: z.string().min(1), classId: z.string().min(1).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(HHMM),
  endTime: z.string().regex(HHMM), notes: z.string().trim().max(300).nullable().optional(),
}).strict();
const patchSchema = shiftFields.extend({ shiftId: z.string().min(1) });
const deleteSchema = z.object({ shiftId: z.string().min(1) }).strict();

function authError(error: unknown) {
  return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
}
function parseDate(value: string) {
  const date = astDateOnly(new Date(`${value}T00:00:00.000Z`));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function saveShift(request: Request, mode: "create" | "update") {
  let session;
  try { session = await requireSession(); } catch (error) { return authError(error); }
  if (!session.can("schedule.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = (mode === "create" ? shiftFields : patchSchema).safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  if (parsed.data.endTime <= parsed.data.startTime) {
    return Response.json({ error: "End time must be after start time" }, { status: 422 });
  }
  const date = parseDate(parsed.data.date);
  if (!date) return Response.json({ error: "Invalid date" }, { status: 422 });
  let timeZone: string;
  try { timeZone = requestTimeZone(request); } catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }
  const schoolId = session.user.schoolId;
  const today = calendarToday(new Date(), timeZone);
  const shiftId = mode === "update" ? (parsed.data as z.infer<typeof patchSchema>).shiftId : undefined;
  try {
    const shift = await prisma.$transaction(async (tx) => {
      if (shiftId) {
        await tx.$queryRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${`${schoolId}:shift-id:${shiftId}`}, 0))::text
        `);
      }
      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`${schoolId}:shift:${parsed.data.teacherId}:${parsed.data.date}`}, 0))::text
      `);
      const teacher = await tx.teacher.findFirst({
        where: { id: parsed.data.teacherId, schoolId, deletedAt: null, isActive: true, status: "ACTIVE",
          OR: [{ enrollmentEndDate: null }, { enrollmentEndDate: { gte: today } }] },
        select: { id: true, name: true },
      });
      if (!teacher) throw new Error("INELIGIBLE_TEACHER");
      const classroom = parsed.data.classId ? await tx.class.findFirst({
        where: { id: parsed.data.classId, schoolId, deletedAt: null, archivedAt: null }, select: { id: true, name: true },
      }) : null;
      if (parsed.data.classId && !classroom) throw new Error("CLASS_NOT_FOUND");
      if (shiftId) {
        const owned = await tx.shift.findFirst({ where: { id: shiftId, schoolId }, select: { id: true } });
        if (!owned) throw new Error("SHIFT_NOT_FOUND");
      }
      const overlap = await tx.shift.findFirst({ where: {
        schoolId, teacherId: teacher.id, date, ...(shiftId ? { id: { not: shiftId } } : {}),
        startTime: { lt: parsed.data.endTime }, endTime: { gt: parsed.data.startTime },
      }, select: { id: true } });
      if (overlap) throw new Error("SHIFT_OVERLAP");
      const data = { schoolId, teacherId: teacher.id, classId: classroom?.id ?? null,
        classNameSnapshot: classroom?.name ?? null, date, startTime: parsed.data.startTime,
        endTime: parsed.data.endTime, notes: parsed.data.notes?.trim() || null };
      return shiftId ? tx.shift.update({ where: { id: shiftId }, data }) : tx.shift.create({ data });
    });
    await logAction({ school_id: schoolId, action: mode === "create" ? "Created staff shift" : "Updated staff shift",
      entity_type: "shift", entity_id: shift.id, performed_by: session.user.name ?? "admin", request });
    return Response.json({ ...shift, date: shift.date.toISOString().slice(0, 10) }, { status: mode === "create" ? 201 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SHIFT_OVERLAP") return Response.json({ error: "Shift overlaps an existing shift" }, { status: 409 });
    if (code === "SHIFT_NOT_FOUND" || code === "CLASS_NOT_FOUND") return Response.json({ error: "Not found" }, { status: 404 });
    if (code === "INELIGIBLE_TEACHER") return Response.json({ error: "Teacher is not eligible for new shifts" }, { status: 409 });
    throw error;
  }
}

export async function GET(request: Request) {
  let session;
  try { session = await requireSession(); } catch (error) { return authError(error); }
  if (!session.can("schedule.view")) return Response.json({ error: "Forbidden" }, { status: 403 });
  const schoolId = session.user.schoolId;
  let timeZone: string;
  try { timeZone = requestTimeZone(request); } catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }
  const params = new URL(request.url).searchParams;
  const requestedStart = params.get("start");
  const anchor = requestedStart ? parseDate(requestedStart) : null;
  if (requestedStart && !anchor) return Response.json({ error: "Invalid date" }, { status: 422 });
  const weekStart = anchor ? new Date(anchor) : deviceWeekStart(new Date(), timeZone);
  if (anchor) weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  let rangeStart = weekStart;
  let rangeEnd = weekEnd;
  const from = params.get("from");
  const to = params.get("to");
  if (from && to) {
    const parsedFrom = new Date(from);
    const parsedTo = new Date(to);
    if (Number.isNaN(parsedFrom.getTime()) || Number.isNaN(parsedTo.getTime()) || parsedTo <= parsedFrom || parsedTo.getTime() - parsedFrom.getTime() > 62 * 86_400_000) {
      return Response.json({ error: "Invalid date range" }, { status: 422 });
    }
    rangeStart = astDateOnly(parsedFrom);
    rangeEnd = astDateOnly(parsedTo);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
  }
  const teacherId = params.get("teacherId");
  const today = calendarToday(new Date(), timeZone);
  const [teachers, classes, shifts] = await Promise.all([
    prisma.teacher.findMany({ where: { schoolId, deletedAt: null, isActive: true, status: "ACTIVE",
      OR: [{ enrollmentEndDate: null }, { enrollmentEndDate: { gte: today } }], ...(teacherId ? { id: teacherId } : {}) },
      select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.class.findMany({ where: { schoolId, deletedAt: null, archivedAt: null },
      select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.shift.findMany({ where: { schoolId, date: { gte: rangeStart, lt: rangeEnd }, ...(teacherId ? { teacherId } : {}) },
      select: { id: true, teacherId: true, classId: true, classNameSnapshot: true,
        class: { select: { name: true } }, teacher: { select: { name: true } }, date: true,
        startTime: true, endTime: true, notes: true }, orderBy: [{ date: "asc" }, { startTime: "asc" }] }),
  ]);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart); day.setUTCDate(day.getUTCDate() + index); return day.toISOString().slice(0, 10);
  });
  return withNoStore(Response.json({ weekStart: weekStart.toISOString().slice(0, 10), days, teachers, classes,
    shifts: shifts.map(({ class: classroom, teacher, ...shift }) => ({ ...shift,
      teacherName: teacher.name, className: classroom?.name ?? shift.classNameSnapshot,
      date: shift.date.toISOString().slice(0, 10) })) }));
}

export async function POST(request: Request) { return saveShift(request, "create"); }
export async function PATCH(request: Request) { return saveShift(request, "update"); }
export async function DELETE(request: Request) {
  let session;
  try { session = await requireSession(); } catch (error) { return authError(error); }
  if (!session.can("schedule.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  const result = await prisma.shift.deleteMany({ where: { id: parsed.data.shiftId, schoolId: session.user.schoolId } });
  if (result.count !== 1) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ deleted: 1 });
}
