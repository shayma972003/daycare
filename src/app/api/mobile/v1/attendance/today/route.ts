import { requireMobileAuth, mobileAuthResponse } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { astDayStart, astDayEnd } from "@/lib/datetime";
import { stampFileUrl } from "@/lib/file-token";

/**
 * Today's roster for the teacher app.
 *
 * `/api/mobile/v1` had no attendance routes at all — auth, care reports,
 * devices and me — so the one thing a teacher opens her phone to do could not
 * be done from it. The dashboard's `page-data` route answers the same question
 * but authenticates with a cookie, which an app does not have.
 *
 * Staff only. A guardian sees her own children's attendance through the portal
 * feed, not a roster of everyone else's.
 *
 * Avatars are stamped: an `<img>` in a native app cannot send a bearer token,
 * so a private R2 object needs a grant in the URL. See src/lib/file-token.ts.
 */
export async function GET(request: Request) {
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
  const url = new URL(request.url);
  const classId = url.searchParams.get("classId");

  const now = new Date();
  const dayStart = astDayStart(now);
  // Documented exclusive — paired with `lt`, never `lte`.
  const dayEnd = astDayEnd(now);

  const students = await prisma.student.findMany({
    where: {
      schoolId,
      isActive: true,
      deletedAt: null,
      ...(classId ? { classId } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      period: true,
      class: { select: { id: true, name: true } },
      attendances: {
        where: { checkinAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { checkinAt: "desc" },
        take: 1,
        select: { id: true, checkinAt: true, checkoutAt: true },
      },
    },
  });

  return Response.json({
    date: dayStart.toISOString(),
    children: students.map((student) => {
      const today = student.attendances[0] ?? null;
      return {
        id: student.id,
        name: student.name,
        avatarUrl: stampFileUrl(student.avatarUrl),
        period: student.period,
        classId: student.class?.id ?? null,
        className: student.class?.name ?? null,
        checkedInAt: today?.checkinAt?.toISOString() ?? null,
        checkedOutAt: today?.checkoutAt?.toISOString() ?? null,
        /** What the button should offer next, so the app does not re-derive it. */
        nextAction: !today ? "checkin" : today.checkoutAt ? "done" : "checkout",
      };
    }),
  });
}
