import { requireSession, sessionErrorResponse } from "@/lib/session";
import { calendarToday, requestTimeZone } from "@/lib/device-date";
import { AttendanceOperationError, checkInTeacher } from "@/lib/attendance-operations";
import { z } from "zod";

const schema = z.object({ teacher_id: z.string().min(1) });

export async function POST(request: Request) {
  let session;
  try { session = await requireSession(); }
  catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.can("attendance.staff")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const now = new Date();
  let date: Date;
  try { date = calendarToday(now, requestTimeZone(request)); }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }

  try {
    const attendance = await checkInTeacher({
      teacherId: parsed.data.teacher_id,
      schoolId,
      date,
      now,
    });
    return Response.json({ attendance_id: attendance.id, checkin_time: attendance.checkinAt }, { status: 201 });
  } catch (error) {
    if (error instanceof AttendanceOperationError) {
      return Response.json({ error: "Teacher could not be checked in", code: error.code }, { status: error.status });
    }
    throw error;
  }
}
