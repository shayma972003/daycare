import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { ENROLLMENT_MANAGE_PERMISSION } from "@/lib/enrollment-access";
import { keyFromUrl } from "@/lib/r2";
import {
  completeStoredFileDeletion,
  markStoredFileForDeletion,
  StoredFileOwnershipError,
  type ExactStoredFileOwner,
} from "@/lib/stored-files";
import { STORED_FILE_OWNER } from "@/lib/stored-file-ownership";

class EnrollmentReviewConflict extends Error {}

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
  if (!session.can(ENROLLMENT_MANAGE_PERMISSION)) {
    return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  const schoolId = session.user.schoolId;
  const { submission_id } = await params;

  const sub = await prisma.enrollmentSubmission.findFirst({
    where: { id: submission_id, school_id: schoolId },
  });
  if (!sub) return Response.json({ error: "Not found" }, { status: 404 });

  if (sub.status === "approved") {
    return Response.json({ error: "Enrollment request is no longer pending" }, { status: 409 });
  }

  const fileKey = keyFromUrl(sub.evaluation_file_url);
  const fileOwner: ExactStoredFileOwner | null = fileKey
    ? {
        key: fileKey,
        schoolId,
        ownerType: STORED_FILE_OWNER.ENROLLMENT_SUBMISSION,
        ownerId: sub.id,
      }
    : null;

  if (sub.status === "pending_review") {
    try {
      await prisma.$transaction(async (tx) => {
        const rejected = await tx.enrollmentSubmission.updateMany({
          where: { id: submission_id, school_id: schoolId, status: "pending_review" },
          data: { status: "rejected", reviewed_at: new Date() },
        });
        if (rejected.count !== 1) throw new EnrollmentReviewConflict();

        if (fileOwner) {
          const marked = await markStoredFileForDeletion(tx, fileOwner);
          if (marked !== "pending") throw new StoredFileOwnershipError();
        }
      });
    } catch (error) {
      if (error instanceof EnrollmentReviewConflict) {
        return Response.json({ error: "Enrollment request is no longer pending" }, { status: 409 });
      }
      if (error instanceof StoredFileOwnershipError) {
        return Response.json({ error: "Enrollment file ownership is invalid" }, { status: 409 });
      }
      throw error;
    }
  } else if (fileOwner) {
    const marked = await markStoredFileForDeletion(prisma, fileOwner);
    if (marked !== "pending") {
      return Response.json({ error: "Enrollment file ownership is invalid" }, { status: 409 });
    }
  }

  if (fileOwner) {
    const deleted = await completeStoredFileDeletion(fileOwner);
    if (deleted.status === "pending") {
      return Response.json(
        { error: "File cleanup is temporarily unavailable", cleanup_pending: true },
        { status: 502 }
      );
    }
    if (deleted.status === "deleted" || deleted.status === "missing") {
      await prisma.enrollmentSubmission.updateMany({
        where: { id: submission_id, school_id: schoolId, status: "rejected" },
        data: { evaluation_file_url: null, evaluation_file_name: null },
      });
    }
  }

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
