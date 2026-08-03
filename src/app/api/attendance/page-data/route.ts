import { requireSession, sessionErrorResponse } from "@/lib/session";
import { getAttendancePageData } from "@/lib/attendance-data";

export async function GET() {
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

  const data = await getAttendancePageData(schoolId);
  return Response.json(data);
}
