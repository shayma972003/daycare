import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { bulkSummary, type BulkItemResult } from "@/lib/bulk-result";

const schema = z.object({
  teacherIds: z.array(z.string()).min(1),
  action: z.enum(["checkin", "checkout"]),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const { teacherIds, action } = parsed.data;

  const nowUtc = new Date();
  const offsetMs = 3 * 60 * 60 * 1000;
  const todayAst = new Date(nowUtc.getTime() + offsetMs);
  todayAst.setUTCHours(0, 0, 0, 0);
  const tomorrowAst = new Date(todayAst.getTime() + 24 * 60 * 60 * 1000);

  const results: BulkItemResult[] = [];

  if (action === "checkin") {
    for (const teacherId of teacherIds) {
      const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId, deletedAt: null } });
      if (!teacher) {
        results.push({ id: teacherId, status: "failed", code: "NOT_FOUND" });
        continue;
      }

      const existing = await prisma.teacherAttendance.findFirst({
        where: { teacherId, schoolId, date: { gte: todayAst, lt: tomorrowAst } },
      });

      if (existing && !existing.checkoutAt) {
        results.push({ id: teacherId, status: "skipped", code: "ALREADY_CHECKED_IN" });
        continue;
      }

      await prisma.teacherAttendance.create({
        data: { teacherId, schoolId, checkinAt: nowUtc, date: todayAst },
      });
      results.push({ id: teacherId, status: "succeeded" });
    }
  } else {
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    const [inH, inM] = (school?.teacherCheckinTime ?? "08:00").split(":").map(Number);
    const [outH, outM] = (school?.teacherCheckoutTime ?? "17:00").split(":").map(Number);
    const requiredHours = (outH * 60 + outM - (inH * 60 + inM)) / 60;

    for (const teacherId of teacherIds) {
      const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId, deletedAt: null } });
      if (!teacher) {
        results.push({ id: teacherId, status: "failed", code: "NOT_FOUND" });
        continue;
      }

      const existing = await prisma.teacherAttendance.findFirst({
        where: { teacherId, schoolId, date: { gte: todayAst, lt: tomorrowAst }, checkoutAt: null, checkinAt: { not: null } },
      });

      if (!existing) {
        results.push({ id: teacherId, status: "skipped", code: "NOT_CHECKED_IN" });
        continue;
      }

      const actualHours = (nowUtc.getTime() - new Date(existing.checkinAt!).getTime()) / 3600000;
      const compensated = requiredHours <= 0 || actualHours >= requiredHours;
      let lateHours = 0;
      let lateMinutes = 0;
      if (!compensated) {
        lateHours = requiredHours - actualHours;
        lateMinutes = Math.round(lateHours * 60);
      }

      await prisma.teacherAttendance.update({
        where: { id: existing.id },
        data: { checkoutAt: nowUtc, lateMinutes, requiredHours, compensated },
      });

      await prisma.teacher.update({
        where: { id: teacherId },
        data: { attendanceHours: { increment: actualHours }, lateHours: { increment: lateHours } },
      });

      results.push({ id: teacherId, status: "succeeded" });
    }
  }

  const summary = bulkSummary(results);
  return Response.json({ processed: summary.succeeded, ...summary }, { status: summary.failed > 0 ? 207 : 200 });
}
