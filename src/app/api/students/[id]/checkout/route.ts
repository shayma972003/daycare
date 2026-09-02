import { requireSession, sessionErrorResponse } from "@/lib/session";
import { logAction } from "@/lib/activity-logger";
import { requestTimeZone } from "@/lib/device-date";
import { AttendanceOperationError, checkoutStudent } from "@/lib/attendance-operations";

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
  let timeZone: string;
  try { timeZone = requestTimeZone(request); }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }

  try {
    const result = await checkoutStudent({ studentId: id, schoolId, now: new Date(), timeZone });
    await logAction({
      school_id: schoolId,
      action: "تسجيل انصراف الطفل: " + result.personName,
      entity_type: "student",
      entity_id: id,
      entity_name: result.personName,
      performed_by: session.user.name ?? "المدير",
      request,
    });
    return Response.json({
      id: result.attendanceId,
      checkoutAt: result.checkoutAt,
      totalHours: result.totalHours,
      lateHours: result.lateHours,
      lateFee: result.lateFee,
    });
  } catch (error) {
    if (error instanceof AttendanceOperationError) {
      return Response.json({ error: "Attendance could not be closed", code: error.code }, { status: error.status });
    }
    throw error;
  }
}
