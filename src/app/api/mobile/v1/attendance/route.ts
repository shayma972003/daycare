import { requireMobileAuth, mobileAuthResponse } from "@/lib/mobile-guard";
import { calendarToday, requestTimeZone } from "@/lib/device-date";
import {
  AttendanceOperationError,
  checkInStudent,
  checkoutStudent,
} from "@/lib/attendance-operations";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";

/**
 * Check a child in or out from the app.
 *
 * This endpoint is only a mobile transport for the same central operations the
 * dashboard uses. It accepts the device zone, while all recorded instants still
 * come from the server. Keeping the locking and arithmetic in one place avoids
 * two clients applying different attendance rules to the same child.
 *
 * A duplicate check-in answers 409. That is not an error to hide: it means
 * somebody already did it, and the app should say so rather than silently
 * overwrite a time another member of staff recorded.
 */
const schema = z.object({
  studentId: z.string().min(1),
  action: z.enum(["checkin", "checkout"]),
});

export async function POST(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, {
      kind: "staff",
      permission: "attendance.students",
    });
  } catch (error) {
    const response = mobileAuthResponse(error);
    if (response) return response;
    throw error;
  }

  const schoolId = context.claims.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  }

  const { studentId, action } = parsed.data;

  let timeZone: string;
  const now = new Date();
  try {
    timeZone = requestTimeZone(request);
  } catch {
    return Response.json({ error: "Invalid time zone" }, { status: 422 });
  }

  try {
    if (action === "checkin") {
      const attendance = await checkInStudent({
        studentId,
        schoolId,
        date: calendarToday(now, timeZone),
        now,
      });
      await logAction({
        school_id: schoolId,
        action: `تسجيل وصول الطالب من التطبيق: ${attendance.personName}`,
        entity_type: "student",
        entity_id: studentId,
        entity_name: attendance.personName,
        performed_by: `mobile:${context.claims.sub}`,
        request,
      });
      return Response.json({
        id: attendance.id,
        checkedInAt: attendance.checkinAt?.toISOString() ?? null,
        checkedOutAt: null,
        nextAction: "checkout",
      });
    }

    const attendance = await checkoutStudent({ studentId, schoolId, now, timeZone });
    await logAction({
      school_id: schoolId,
      action: `تسجيل خروج الطالب من التطبيق: ${attendance.personName}`,
      entity_type: "student",
      entity_id: studentId,
      entity_name: attendance.personName,
      performed_by: `mobile:${context.claims.sub}`,
      request,
    });
    return Response.json({
      id: attendance.attendanceId,
      checkedInAt: attendance.checkinAt.toISOString(),
      checkedOutAt: attendance.checkoutAt.toISOString(),
      nextAction: "done",
    });
  } catch (error) {
    if (error instanceof AttendanceOperationError) {
      const messages: Record<string, string> = {
        NOT_FOUND: "الطفل غير موجود",
        NOT_ELIGIBLE: "الطفل غير مؤهل لتسجيل حضور جديد",
        ALREADY_CHECKED_IN: "الطفل مسجل دخوله بالفعل",
        NO_ACTIVE_ATTENDANCE: "لا يوجد حضور مفتوح للطفل",
        OVERLAPPING_OPEN_ATTENDANCE: "توجد سجلات حضور مفتوحة تحتاج مراجعة",
        ALREADY_CHECKED_OUT: "الطفل مسجل خروجه بالفعل",
        INVALID_ATTENDANCE_TIME: "وقت الحضور غير صالح",
      };
      return Response.json(
        { error: messages[error.code] ?? "تعذر تسجيل الحضور", code: error.code },
        { status: error.status }
      );
    }
    throw error;
  }
}
