import { requireMobileAuth, mobileAuthResponse, guardianChildIds } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { astDayStart, astDayEnd } from "@/lib/datetime";

/**
 * Today's attendance for a guardian's own children.
 *
 * Separate from `/attendance/today`, which is the staff roster. Sharing one
 * route and branching on `kind` inside would mean the guardian path is one
 * missing `if` away from returning the whole school — a parent asking after
 * their own child should not be executing the same query as a teacher taking
 * the register.
 *
 * "Has my child arrived" is the first question a parent opens this app with, so
 * it answers only that: a time in, a time out, and nothing else.
 */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, { kind: "guardian" });
  } catch (error) {
    const response = mobileAuthResponse(error);
    if (response) return response;
    throw error;
  }

  const allowedIds = await guardianChildIds(context.claims.sub);
  if (allowedIds.length === 0) return Response.json({ children: [] });

  const now = new Date();
  const dayStart = astDayStart(now);
  // Documented exclusive — paired with `lt`, never `lte`.
  const dayEnd = astDayEnd(now);

  const rows = await prisma.attendance.findMany({
    where: {
      studentId: { in: allowedIds },
      // The child ids already imply the tenant; the filter costs nothing and
      // means one bug cannot reach across schools.
      schoolId: context.claims.schoolId,
      checkinAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { checkinAt: "desc" },
    select: { studentId: true, checkinAt: true, checkoutAt: true, status: true },
  });

  /**
   * Keyed by child, newest first.
   *
   * There is one row per child per day by constraint, but reading defensively
   * costs nothing and a duplicate would otherwise silently pick an arbitrary
   * one.
   */
  const byChild = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!byChild.has(row.studentId)) byChild.set(row.studentId, row);
  }

  return Response.json({
    date: dayStart.toISOString(),
    children: allowedIds.map((id) => {
      const row = byChild.get(id) ?? null;
      return {
        childId: id,
        checkedInAt: row?.checkinAt?.toISOString() ?? null,
        checkedOutAt: row?.checkoutAt?.toISOString() ?? null,
        status: row?.status ?? null,
      };
    }),
  });
}
