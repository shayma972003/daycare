import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ENROLLMENT_MANAGE_PERMISSION } from "@/lib/enrollment-access";

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
  if (!session.can(ENROLLMENT_MANAGE_PERMISSION)) {
    return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  const schoolId = session.user.schoolId;

  const submissions = await prisma.enrollmentSubmission.findMany({
    where: { school_id: schoolId, status: "pending_review" },
    orderBy: { submitted_at: "desc" },
  });

  return Response.json(submissions);
}
