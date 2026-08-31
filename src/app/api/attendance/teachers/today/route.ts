import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { calendarToday, requestTimeZone } from "@/lib/device-date";
import { withNoStore } from "@/lib/auth-response";

export async function GET(request: Request) {
  let session;
  try { session = await requireSession(); } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  if (!session.can("attendance.staff")) {
    return withNoStore(Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  let todayAst: Date;
  try { todayAst = calendarToday(new Date(), requestTimeZone(request)); }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }
  const tomorrowAst = new Date(todayAst.getTime() + 24 * 60 * 60 * 1000);

  const attendances = await prisma.teacherAttendance.findMany({
    where: {
      schoolId,
      OR: [
        { date: { gte: todayAst, lt: tomorrowAst } },
        { checkinAt: { not: null }, checkoutAt: null },
      ],
      teacher: { deletedAt: null, anonymizedAt: null },
    },
    select: { id: true, teacherId: true, date: true, checkinAt: true, checkoutAt: true, lateMinutes: true },
  });

  const chosen = new Map<string, (typeof attendances)[number]>();
  for (const attendance of attendances) {
    const current = chosen.get(attendance.teacherId);
    const isOpen = Boolean(attendance.checkinAt && !attendance.checkoutAt);
    const currentIsOpen = Boolean(current?.checkinAt && !current.checkoutAt);
    if (!current || (isOpen && !currentIsOpen) || attendance.date > current.date) {
      chosen.set(attendance.teacherId, attendance);
    }
  }
  return withNoStore(Response.json([...chosen.values()], { status: 200 }));
}
