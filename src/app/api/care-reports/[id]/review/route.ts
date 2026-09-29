import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { scopedClassIds } from "@/lib/student-access-scope";
import { notifyGuardiansOfReport } from "@/lib/care-report-notify";
import { logAction } from "@/lib/activity-logger";
import { logSafeError } from "@/lib/safe-logger";

const bodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).nullish(),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });

  const { id } = await params;
  const schoolId = session.user.schoolId;
  const now = new Date();
  const nextStatus = parsed.data.action === "APPROVE" ? "APPROVED" : "REJECTED";

  const outcome = await prisma.$transaction(async (tx) => {
    const anchor = await tx.careReport.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, dailyBatchId: true, reviewStatus: true },
    });
    if (!anchor) return { kind: "missing" as const };

    const groupWhere = anchor.dailyBatchId
      ? { schoolId, dailyBatchId: anchor.dailyBatchId, deletedAt: null }
      : { schoolId, id: anchor.id, deletedAt: null };
    const groupRows = await tx.careReport.findMany({
      where: groupWhere,
      select: { id: true, reviewStatus: true },
    });
    if (
      parsed.data.action === "APPROVE" &&
      groupRows.some((row) => row.reviewStatus === "REJECTED")
    ) {
      return { kind: "requires-resubmission" as const };
    }
    const candidates = groupRows.filter((row) => row.reviewStatus !== nextStatus);
    if (candidates.length === 0) {
      const retryIds = parsed.data.action === "APPROVE"
        ? (await tx.careReport.findMany({
            where: { ...groupWhere, reviewStatus: "APPROVED", guardianNotifiedAt: null },
            select: { id: true },
          })).map((row) => row.id)
        : [];
      return { kind: "unchanged" as const, reportIds: retryIds };
    }

    const changed = await tx.careReport.updateMany({
      where: {
        schoolId,
        OR: candidates.map((row) => ({ id: row.id, reviewStatus: row.reviewStatus })),
      },
      data: {
        reviewStatus: nextStatus,
        reviewedAt: now,
        reviewedById: session.user.id,
        reviewedByName: session.user.name ?? "الإدارة",
        reviewNote: parsed.data.note || null,
        ...(parsed.data.action === "REJECT" ? { guardianNotifiedAt: null } : {}),
      },
    });
    return {
      kind: "changed" as const,
      count: changed.count,
      reportIds: parsed.data.action === "APPROVE" && changed.count > 0
        ? candidates.map((row) => row.id)
        : [],
    };
  });

  if (outcome.kind === "missing") return Response.json({ error: "Not found" }, { status: 404 });
  if (outcome.kind === "requires-resubmission") {
    return Response.json({
      error: "يجب أن تعدّل المعلمة التقرير وتعيد إرساله قبل اعتماده",
      code: "RETURNED_REPORT_REQUIRES_RESUBMISSION",
    }, { status: 409 });
  }

  if (parsed.data.action === "APPROVE" && outcome.reportIds.length > 0) {
    await notifyGuardiansOfReport(schoolId, outcome.reportIds)
      .catch((error) => {
        logSafeError("care-report-review-notify", error);
        return 0;
      });
  }

  await logAction({
    school_id: schoolId,
    action: parsed.data.action === "APPROVE" ? "اعتماد تقرير الرعاية وإرساله" : "إرجاع تقرير الرعاية للتعديل",
    entity_type: "care_report",
    entity_id: id,
    performed_by: session.user.name ?? "الإدارة",
    request,
  });

  return Response.json({
    success: true,
    status: nextStatus,
    changed: outcome.kind === "changed" ? outcome.count : 0,
    duplicate: outcome.kind === "unchanged",
  });
}
