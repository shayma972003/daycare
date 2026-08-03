import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submission_id: string }> }
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
  const { submission_id } = await params;

  const sub = await prisma.enrollmentSubmission.findFirst({
    where: { id: submission_id, school_id: schoolId },
  });
  if (!sub) return Response.json({ error: "Not found" }, { status: 404 });

  await prisma.enrollmentSubmission.update({
    where: { id: submission_id },
    data: { status: "rejected", reviewed_at: new Date() },
  });

  await logAction({
    school_id: schoolId,
    action: `رفض طلب تسجيل الطالب: ${sub.full_name}`,
    entity_type: "enrollment",
    entity_id: submission_id,
    entity_name: sub.full_name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
