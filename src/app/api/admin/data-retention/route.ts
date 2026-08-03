import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import {
  getRetentionOverview,
  isValidRetentionYears,
  MIN_RETENTION_YEARS,
  MAX_RETENTION_YEARS,
  SYSTEM_SETTINGS_ID,
} from "@/lib/data-retention";
import { z } from "zod";

/**
 * Retention policy administration.
 *
 * Super-admin only, and deliberately not exposed to tenants: the period is a
 * platform-level promise made in the privacy policy and the DPA, not a per-
 * nursery preference. See the note on the SystemSettings model.
 */

const updateSchema = z.object({
  studentRetentionYears: z.number().int().optional(),
  employeeRetentionYears: z.number().int().optional(),
  anonymizationEnabled: z.boolean().optional(),
});

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const overview = await getRetentionOverview();
    const recent = await prisma.anonymizationLog.findMany({
      orderBy: { anonymizedAt: "desc" },
      take: 20,
      select: {
        id: true,
        entityType: true,
        anonymizedAt: true,
        executedBy: true,
        clearedFieldCount: true,
        retentionYears: true,
      },
    });

    return Response.json({
      ...overview,
      limits: { min: MIN_RETENTION_YEARS, max: MAX_RETENTION_YEARS },
      recent,
    });
  } catch (error) {
    console.error("[GET /api/admin/data-retention] error:", error);
    return Response.json({ error: "حدث خطأ، يرجى المحاولة مجدداً" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { studentRetentionYears, employeeRetentionYears, anonymizationEnabled } = parsed.data;

  // Range is enforced here and not only in the form: an out-of-range period is
  // not a validation nicety, it is either a policy that keeps children's data
  // for ever or one that destroys records the nursery still needs.
  for (const value of [studentRetentionYears, employeeRetentionYears]) {
    if (value !== undefined && !isValidRetentionYears(value)) {
      return Response.json(
        {
          error: `مدة الاحتفاظ يجب أن تكون بين ${MIN_RETENTION_YEARS} و ${MAX_RETENTION_YEARS} سنوات`,
        },
        { status: 422 }
      );
    }
  }

  try {
    const updated = await prisma.systemSettings.update({
      where: { id: SYSTEM_SETTINGS_ID },
      data: {
        ...(studentRetentionYears !== undefined && { studentRetentionYears }),
        ...(employeeRetentionYears !== undefined && { employeeRetentionYears }),
        ...(anonymizationEnabled !== undefined && { anonymizationEnabled }),
        updatedBy: session.adminId,
      },
    });

    // Existing departed records are re-dated to the new policy. Leaving them on
    // the old schedule would mean two children who left the same week expire
    // years apart, which is impossible to explain to a regulator — and shortening
    // the period would otherwise have no effect on the very records it was
    // shortened for.
    let rescheduled = 0;
    if (studentRetentionYears !== undefined) {
      rescheduled += await rescheduleStudents(studentRetentionYears);
    }
    if (employeeRetentionYears !== undefined) {
      rescheduled += await rescheduleTeachers(employeeRetentionYears);
    }

    return Response.json({ ...updated, rescheduled });
  } catch (error) {
    console.error("[PUT /api/admin/data-retention] error:", error);
    return Response.json({ error: "تعذر حفظ الإعدادات" }, { status: 500 });
  }
}

/**
 * Recomputes `retentionUntil` in the database.
 *
 * Done as one statement rather than a read-modify-write loop: the tables hold
 * every child who ever left, and pulling them into the application to add a
 * number of years would be a needless full-table round trip.
 *
 * `+ 3h → truncate → − 3h` is `astDayStart()` from src/lib/datetime.ts written
 * in SQL, and must stay identical to it: the same departure has to produce the
 * same expiry whether the date was set by a profile edit or by this statement.
 * Fixed-offset arithmetic is exact here because AST never observes DST — the
 * `AT TIME ZONE` form would have been wrong anyway, since these columns are
 * `timestamp` (no zone) holding UTC, which that operator would have read as
 * local Riyadh time and shifted by three hours in the wrong direction.
 *
 * Already-anonymised rows are excluded — their date is history, and there is
 * nothing left to expire.
 */
async function rescheduleStudents(years: number): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Student"
    SET "retentionUntil" =
          date_trunc('day', "leftAt" + INTERVAL '3 hours')
          - INTERVAL '3 hours'
          + make_interval(years => ${years})
    WHERE "leftAt" IS NOT NULL AND "anonymizedAt" IS NULL
  `;
}

async function rescheduleTeachers(years: number): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Teacher"
    SET "retentionUntil" =
          date_trunc('day', "leftAt" + INTERVAL '3 hours')
          - INTERVAL '3 hours'
          + make_interval(years => ${years})
    WHERE "leftAt" IS NOT NULL AND "anonymizedAt" IS NULL
  `;
}
