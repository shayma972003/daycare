import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ submission_id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  return Response.json({ success: true });
}
