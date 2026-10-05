import { requireSession, sessionErrorResponse } from "@/lib/session";
import { logAction } from "@/lib/activity-logger";
import { calendarToday, requestTimeZone } from "@/lib/device-date";
import { AttendanceOperationError, checkInStudent } from "@/lib/attendance-operations";
import { notifyGuardiansOfAttendance } from "@/lib/attendance-notifications";
import { logSafeError } from "@/lib/safe-logger";
import { scopedClassIds } from "@/lib/student-access-scope";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession(); }
  catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.can("attendance.students")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const schoolId = session.user.schoolId;
  const { id } = await params;
  const now = new Date();
  let date: Date;
  try { date = calendarToday(now, requestTimeZone(request)); }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }

  try {
    const { personName, ...attendance } = await checkInStudent({
      studentId: id,
      schoolId,
      date,
      now,
      classIds: scopedClassIds(session),
    });
    await logAction({
      school_id: schoolId,
      action: "تسجيل وصول الطالب: " + personName,
      entity_type: "student",
      entity_id: id,
      entity_name: personName,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    await notifyGuardiansOfAttendance({
      schoolId,
      studentId: id,
      studentName: personName,
      event: "checkin",
    }).catch((error) => logSafeError("attendance-checkin-notification", error));
    return Response.json(attendance, { status: 201 });
  } catch (error) {
    if (error instanceof AttendanceOperationError) {
      return Response.json({ error: "Student could not be checked in", code: error.code }, { status: error.status });
    }
    throw error;
  }
}
