import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const teacher = await prisma.teacher.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // AST today boundaries (UTC+3)
  const nowUtc = new Date();
  const offsetMs = 3 * 60 * 60 * 1000;
  const todayAst = new Date(nowUtc.getTime() + offsetMs);
  todayAst.setUTCHours(0, 0, 0, 0);
  const tomorrowAst = new Date(todayAst.getTime() + 24 * 60 * 60 * 1000);

  const existing = await prisma.teacherAttendance.findFirst({
    where: { teacherId: id, schoolId, date: { gte: todayAst, lt: tomorrowAst } },
  });

  // Already checked in (and not yet checked out) — return existing record
  if (existing && existing.checkinAt && !existing.checkoutAt) {
    return Response.json(existing, { status: 200 });
  }

  let attendance;
  if (existing) {
    // Had a prior checkout today — update checkin time for re-entry
    attendance = await prisma.teacherAttendance.update({
      where: { id: existing.id },
      data: { checkinAt: nowUtc, checkoutAt: null, lateMinutes: 0 },
    });
  } else {
    attendance = await prisma.teacherAttendance.create({
      data: { teacherId: id, schoolId, checkinAt: nowUtc, date: todayAst },
    });
  }

  return Response.json(attendance, { status: 201 });
}
