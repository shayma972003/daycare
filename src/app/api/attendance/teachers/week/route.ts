import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { calendarToday, requestTimeZone } from "@/lib/device-date";
import { withNoStore } from "@/lib/auth-response";

export async function GET(request: Request) {
  let session;
  try { session = await requireSession(); }
  catch (error) { return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 }); }
  if (!session.can("attendance.staff")) {
    return withNoStore(Response.json({ error: "Forbidden" }, { status: 403 }));
  }
  const schoolId = session.user.schoolId;
  const url = new URL(request.url);
  const classId = url.searchParams.get("classId");
  const search = url.searchParams.get("search")?.trim();
  let today: Date;
  try { today = calendarToday(new Date(), requestTimeZone(request)); }
  catch { return withNoStore(Response.json({ error: "Invalid time zone" }, { status: 422 })); }
  const startParam = url.searchParams.get("start");
  const anchor = startParam ? new Date(`${startParam}T00:00:00.000Z`) : today;
  if (Number.isNaN(anchor.getTime())) return withNoStore(Response.json({ error: "Invalid date" }, { status: 422 }));
  const weekStart = new Date(anchor);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), weekday: date.getUTCDay() };
  });
  const teachers = await prisma.teacher.findMany({
    where: { schoolId, deletedAt: null, anonymizedAt: null, ...(search ? { name: { contains: search, mode: "insensitive" } } : {}), ...(classId ? { classes: { some: { id: classId, schoolId, deletedAt: null } } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, teacherAttendances: { where: { schoolId, date: { gte: weekStart, lt: weekEnd } }, select: { date: true, checkinAt: true, checkoutAt: true } } },
  });
  const key = (date: Date) => date.toISOString().slice(0, 10);
  const rows = teachers.map((teacher) => {
    const records = new Map(teacher.teacherAttendances.map((record) => [key(record.date), record]));
    return { teacherId: teacher.id, name: teacher.name, cells: days.map((day) => { const record = records.get(day.date); return { ...day, status: record ? (record.checkoutAt ? "CHECKED_OUT" : "PRESENT") : "NO_RECORD", checkinAt: record?.checkinAt?.toISOString() ?? null, checkoutAt: record?.checkoutAt?.toISOString() ?? null }; }) };
  });
  return withNoStore(Response.json({ weekStart: weekStart.toISOString().slice(0, 10), days, rows }));
}
