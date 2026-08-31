import { requireSession, sessionErrorResponse } from "@/lib/session";
import { getAttendancePageData } from "@/lib/attendance-data";
import { withNoStore } from "@/lib/auth-response";
import { calendarToday, requestTimeZone } from "@/lib/device-date";

export async function GET(request: Request) {
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
  const schoolId = session.user.schoolId;

  const visibility = {
    students: session.can("attendance.students"),
    teachers: session.can("attendance.staff"),
  };
  if (!visibility.students && !visibility.teachers) {
    return withNoStore(Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }));
  }

  let today: Date;
  try { today = calendarToday(new Date(), requestTimeZone(request)); }
  catch { return withNoStore(Response.json({ error: "Invalid time zone" }, { status: 422 })); }
  const data = await getAttendancePageData(schoolId, visibility, today);
  return withNoStore(Response.json(data));
}
