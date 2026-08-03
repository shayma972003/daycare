import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import {
  buildTeacherDeparture,
  getRetentionPolicy,
  EMPLOYMENT_STATUSES,
} from "@/lib/data-retention";
import { EMPLOYMENT_STATUS_LABELS } from "@/lib/enum-labels";
import { z } from "zod";
import type { EmploymentStatus } from "@/generated/prisma/enums";

/**
 * Ending a staff member's engagement (task D3.13).
 *
 * The reason and the date are inputs, not assumptions. `leftAt` starts the
 * retention clock — personal data is erased five years from it — so a date
 * defaulted to "today" when the person actually left in March is a wrong erasure
 * date, silently. And "resigned" versus "terminated" is a fact the nursery has
 * to be able to state later; there is nowhere else it is recorded.
 *
 * Both stay optional so the older callers that posted an empty body keep working
 * with the previous behaviour: contract ended, today.
 */
const bodySchema = z.object({
  status: z
    .enum(EMPLOYMENT_STATUSES as [EmploymentStatus, ...EmploymentStatus[]])
    .optional(),
  leftAt: z.string().datetime().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  const teacher = await prisma.teacher.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!teacher) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // An empty body is valid — see the schema above.
  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    /* no body */
  }

  const parsed = bodySchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const status = parsed.data.status ?? "CONTRACT_ENDED";
  const leftAt = parsed.data.leftAt
    ? new Date(parsed.data.leftAt)
    : (teacher.leftAt ?? null);

  if (leftAt && Number.isNaN(leftAt.getTime())) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }

  // Same reasoning as the student cancel route: ending the engagement has to set
  // `leftAt`, otherwise the record is archived with no expiry and the sweep will
  // never reach it.
  const policy = await getRetentionPolicy();
  const updated = await prisma.teacher.update({
    where: { id },
    data: buildTeacherDeparture(status, leftAt, policy.employeeRetentionYears),
  });

  await logAction({
    school_id: schoolId,
    action:
      status === "ACTIVE"
        ? `إعادة تفعيل الموظف: ${teacher.name}`
        : `${EMPLOYMENT_STATUS_LABELS[status]}: ${teacher.name}`,
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(updated);
}
