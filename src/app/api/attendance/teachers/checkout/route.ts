import { requireSession, sessionErrorResponse } from "@/lib/session";
import { requestTimeZone } from "@/lib/device-date";
import { AttendanceOperationError, checkoutTeacher } from "@/lib/attendance-operations";
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
  let timeZone: string;
  try { timeZone = requestTimeZone(request); }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }

  try {
    const result = await checkoutTeacher({ teacherId: parsed.data.teacher_id, schoolId, now: new Date(), timeZone });
    return Response.json({
      checkout_time: result.checkoutAt,
      total_hours: result.totalHours,
      late_hours: result.lateHours,
    });
  } catch (error) {
    if (error instanceof AttendanceOperationError) {
      return Response.json({ error: "Attendance could not be closed", code: error.code }, { status: error.status });
    }
    throw error;
  }
}
