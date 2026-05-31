import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  // "Today" in AST (UTC+3)
  const nowUtc = new Date();
  const offsetMs = 3 * 60 * 60 * 1000;
  const todayAst = new Date(nowUtc.getTime() + offsetMs);
  todayAst.setUTCHours(0, 0, 0, 0);
  const tomorrowAst = new Date(todayAst.getTime() + 24 * 60 * 60 * 1000);

  const attendances = await prisma.attendance.findMany({
    where: {
      schoolId,
      date: { gte: todayAst, lt: tomorrowAst },
    },
    select: {
      id: true,
      studentId: true,
      checkinAt: true,
      checkoutAt: true,
      lateMinutes: true,
      lateFee: true,
    },
  });

  return Response.json(attendances, { status: 200 });
}
