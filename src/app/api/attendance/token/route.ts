import { requireSession, sessionErrorResponse } from "@/lib/session";
import { ensureAttendanceToken, rotateAttendanceToken } from "@/lib/attendance-token";
import { logAction } from "@/lib/activity-logger";

/** Current kiosk token, minted on first request. */
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

  const schoolId = (session.user as { schoolId: string }).schoolId;
  const token = await ensureAttendanceToken(schoolId);

  return Response.json({ token });
}

/**
 * Issues a new token and invalidates every QR code printed from the old one —
 * the recovery path for a code that leaked or a tablet that walked off.
 */
export async function POST(request: Request) {
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

  const schoolId = (session.user as { schoolId: string }).schoolId;
  const token = await rotateAttendanceToken(schoolId);

  logAction({
    school_id: schoolId,
    action: "تم تجديد رمز جهاز الحضور — رموز QR السابقة لم تعد صالحة",
    entity_type: "settings",
    performed_by: session.user?.name ?? "المدير",
    request,
  }).catch(() => {});

  return Response.json({ token });
}
