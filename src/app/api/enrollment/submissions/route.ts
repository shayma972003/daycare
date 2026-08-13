import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ENROLLMENT_MANAGE_PERMISSION } from "@/lib/enrollment-access";
import { revealEnrollmentSubmissionIdNumber } from "@/lib/enrollment-submission-pii";

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

  return Response.json(submissions.map((submission) => {
    const publicFields = {
      ...submission,
      id_number: revealEnrollmentSubmissionIdNumber({
        id_number: submission.id_number,
        encrypted_id_number: submission.encrypted_id_number,
      }),
    };
    delete (publicFields as Partial<typeof submission>).encrypted_id_number;
    delete (publicFields as Partial<typeof submission>).id_number_hash;
    return publicFields;
  }));
}
