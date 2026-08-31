import { requireSession, sessionErrorResponse } from "@/lib/session";
import { logAction } from "@/lib/activity-logger";
import { calendarToday, requestTimeZone } from "@/lib/device-date";
import { AttendanceOperationError, checkInTeacher } from "@/lib/attendance-operations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession(); }
  catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.can("attendance.staff")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const schoolId = session.user.schoolId;
  const { id } = await params;
  const now = new Date();
  let date: Date;
  try { date = calendarToday(now, requestTimeZone(request)); }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }

  try {
    const { personName, ...attendance } = await checkInTeacher({ teacherId: id, schoolId, date, now });
    await logAction({
      school_id: schoolId,
      action: "تسجيل وصول المعلم: " + personName,
      entity_type: "teacher",
      entity_id: id,
      entity_name: personName,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return Response.json(attendance, { status: 201 });
  } catch (error) {
    if (error instanceof AttendanceOperationError) {
      return Response.json({ error: "Teacher could not be checked in", code: error.code }, { status: error.status });
    }
    throw error;
  }
}
