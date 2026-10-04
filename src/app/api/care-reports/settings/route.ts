import { z } from "zod";
import { logAction } from "@/lib/activity-logger";
import { withNoStore } from "@/lib/auth-response";
import { loadCareReportPolicy } from "@/lib/care-report-policy";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { scopedClassIds } from "@/lib/student-access-scope";

const updateSchema = z.object({ reviewRequired: z.boolean() }).strict();

function sessionFailure(error: unknown) {
  return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionFailure(error);
  }
  if (!session.can("attendance.students") && !session.can("students.manage")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return withNoStore(Response.json(await loadCareReportPolicy(session.user.schoolId)));
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionFailure(error);
  }
  if (!session.can("students.manage") || scopedClassIds(session) !== null) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });

  const schoolId = session.user.schoolId;
  const saved = await prisma.settings.upsert({
    where: { schoolId },
    create: { schoolId, careReportReviewRequired: parsed.data.reviewRequired },
    update: { careReportReviewRequired: parsed.data.reviewRequired },
    select: { careReportReviewRequired: true },
  });

  await logAction({
    school_id: schoolId,
    action: saved.careReportReviewRequired
      ? "تفعيل مراجعة تقارير الرعاية قبل الإرسال"
      : "تفعيل الإرسال المباشر لتقارير الرعاية",
    entity_type: "settings",
    performed_by: session.user.name ?? "الإدارة",
    request,
  });

  return withNoStore(Response.json({ reviewRequired: saved.careReportReviewRequired }));
}
