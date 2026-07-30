import { requireSession } from "@/lib/session";
import { getAttendancePageData } from "@/lib/attendance-data";

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = session.user.schoolId;

  const data = await getAttendancePageData(schoolId);
  return Response.json(data);
}
