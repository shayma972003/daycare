import { requireSession, sessionErrorResponse } from "@/lib/session";
import { z } from "zod";
import { bulkSummary, type BulkItemResult } from "@/lib/bulk-result";
import { calendarToday, requestTimeZone } from "@/lib/device-date";
import {
  AttendanceOperationError,
  checkInTeacher,
  checkoutTeacher,
} from "@/lib/attendance-operations";

const schema = z.object({
  teacherIds: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["checkin", "checkout"]),
});

function bulkCode(error: unknown, action: "checkin" | "checkout") {
  if (!(error instanceof AttendanceOperationError)) {
    return action === "checkin" ? "CHECKIN_FAILED" : "CHECKOUT_FAILED";
  }
  return error.code;
}
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
  let timeZone: string;
  try {
    timeZone = requestTimeZone(request);
    date = calendarToday(now, timeZone);
  }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }

  const results: BulkItemResult[] = [];
  for (const teacherId of parsed.data.teacherIds) {
    try {
      if (parsed.data.action === "checkin") {
        await checkInTeacher({ teacherId, schoolId, date, now, timeZone });
      } else {
        await checkoutTeacher({ teacherId, schoolId, now, timeZone });
      }
      results.push({ id: teacherId, status: "succeeded" });
    } catch (error) {
      const code = bulkCode(error, parsed.data.action);
      const skipped = error instanceof AttendanceOperationError &&
        ["ALREADY_CHECKED_IN", "ALREADY_CHECKED_OUT", "NO_ACTIVE_ATTENDANCE"].includes(error.code);
      results.push({ id: teacherId, status: skipped ? "skipped" : "failed", code });
    }
  }

  const summary = bulkSummary(results);
  return Response.json(
    { processed: summary.succeeded, ...summary },
    { status: summary.failed > 0 ? 207 : 200 }
  );
}
