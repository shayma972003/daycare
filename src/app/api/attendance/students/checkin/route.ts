import { requireSession, sessionErrorResponse } from "@/lib/session";
import { calendarToday, requestTimeZone } from "@/lib/device-date";
import { AttendanceOperationError, checkInStudent } from "@/lib/attendance-operations";
import { z } from "zod";

const schema = z.object({ student_id: z.string().min(1) });

function operationError(error: unknown) {
  if (!(error instanceof AttendanceOperationError)) return null;
  const message = error.code === "OVERLAPPING_OPEN_ATTENDANCE"
    ? "Attendance records need review"
    : error.code === "NOT_ELIGIBLE"
      ? "Student is not eligible for a new check-in"
      : "Student is already checked in";
  return Response.json({ error: message, code: error.code }, { status: error.status });
}
export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.can("attendance.students")) {
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
    const attendance = await checkInStudent({
      studentId: parsed.data.student_id,
      schoolId,
      date,
      now,
    });
    return Response.json({
      attendance_id: attendance.id,
      checkin_time: attendance.checkinAt,
      status: attendance.status,
    }, { status: 201 });
  } catch (error) {
    const response = operationError(error);
    if (response) return response;
    throw error;
  }
}
