import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const submissions = await prisma.enrollmentSubmission.findMany({
    where: { school_id: schoolId, status: "pending_review" },
    orderBy: { submitted_at: "desc" },
  });

  return Response.json(submissions);
}
