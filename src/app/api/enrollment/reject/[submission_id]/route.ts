import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { activityLogData } from "@/lib/activity-logger";
import { ENROLLMENT_MANAGE_PERMISSION } from "@/lib/enrollment-access";
import { lockEnrollmentSubmission } from "@/lib/enrollment-atomic";
import { keyFromUrl } from "@/lib/r2";
import {
  completeStoredFileDeletion,
  markStoredFileForDeletion,
  StoredFileOwnershipError,
  type ExactStoredFileOwner,
} from "@/lib/stored-files";
import { STORED_FILE_OWNER } from "@/lib/stored-file-ownership";

class EnrollmentReviewConflict extends Error {}
class EnrollmentReviewNotFound extends Error {}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submission_id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.can(ENROLLMENT_MANAGE_PERMISSION)) {
    return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  const schoolId = session.user.schoolId;
  const { submission_id } = await params;
  let fileOwner: ExactStoredFileOwner | null = null;

  try {
    fileOwner = await prisma.$transaction(async (tx) => {
      const locked = await lockEnrollmentSubmission(tx, { id: submission_id, schoolId });
      if (!locked) throw new EnrollmentReviewNotFound();

      const submission = await tx.enrollmentSubmission.findFirst({
        where: { id: submission_id, school_id: schoolId },
      });
      if (!submission) throw new EnrollmentReviewNotFound();
      if (submission.status !== "pending_review") throw new EnrollmentReviewConflict();

      const fileKey = keyFromUrl(submission.evaluation_file_url);
      const owner: ExactStoredFileOwner | null = fileKey
        ? {
            key: fileKey,
            schoolId,
            ownerType: STORED_FILE_OWNER.ENROLLMENT_SUBMISSION,
            ownerId: submission.id,
          }
        : null;

      if (owner) {
        const marked = await markStoredFileForDeletion(tx, owner);
        if (marked !== "pending") throw new StoredFileOwnershipError();
      }

      const rejected = await tx.enrollmentSubmission.updateMany({
        where: { id: submission_id, school_id: schoolId, status: "pending_review" },
        data: { status: "rejected", reviewed_at: new Date() },
      });
      if (rejected.count !== 1) throw new EnrollmentReviewConflict();

      await tx.activityLog.create({
        data: activityLogData({
          school_id: schoolId,
          action: `رفض طلب تسجيل الطالب: ${submission.full_name}`,
          entity_type: "enrollment",
          entity_id: submission_id,
          entity_name: submission.full_name,
          performed_by: session.user.name ?? "المدير",
          request,
        }),
      });
      return owner;
    });
  } catch (error) {
    if (error instanceof EnrollmentReviewNotFound) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (error instanceof EnrollmentReviewConflict) {
      return Response.json({ error: "Enrollment request is no longer pending" }, { status: 409 });
    }
    if (error instanceof StoredFileOwnershipError) {
      return Response.json({ error: "Enrollment file ownership is invalid" }, { status: 409 });
    }
    throw error;
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

  return Response.json({ success: true });
}
