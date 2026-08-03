import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { buildStudentDeparture, getRetentionPolicy } from "@/lib/data-retention";
import { STUDENT_STATUS_LABELS } from "@/lib/enum-labels";
import { z } from "zod";

/**
 * Records a child's departure.
 *
 * The reason is optional and defaults to WITHDRAWN, so the existing "cancel
 * subscription" button keeps working unchanged while the profile screen can now
 * say whether the child graduated, withdrew or transferred. The distinction is
 * not cosmetic: it is the only place the reason a child left is ever captured,
 * and it is what the future sector reports will group departures by.
 */
const schema = z.object({
  status: z.enum(["GRADUATED", "WITHDRAWN", "TRANSFERRED"]).optional(),
  leftAt: z.string().optional(),
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

  // The original caller sends no body at all, so an unparseable request is
  // treated as "no options given" rather than as an error.
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const student = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (student.anonymizedAt) {
    return Response.json(
      { error: "هذا السجل مجهَّل نهائياً ولا يمكن تعديله" },
      { status: 409 }
    );
  }

  const status = parsed.data.status ?? "WITHDRAWN";

  // Cancelling is a departure, so it must start the retention clock too. Setting
  // `isActive` alone would archive the child with no `leftAt` — their personal
  // data would then sit in the database indefinitely, because the nightly sweep
  // only ever reads `retentionUntil`.
  //
  // An explicit date wins; otherwise an existing `leftAt` is preserved, so
  // correcting the reason on an already-departed child does not push their
  // expiry years into the future.
  const leftAt = parsed.data.leftAt
    ? new Date(parsed.data.leftAt)
    : (student.leftAt ?? null);

  const policy = await getRetentionPolicy();
  const updated = await prisma.student.update({
    where: { id },
    data: buildStudentDeparture(status, leftAt, policy.studentRetentionYears),
  });

  await logAction({
    school_id: schoolId,
    action: `إنهاء تسجيل الطالب (${STUDENT_STATUS_LABELS[status]}): ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(updated);
}
