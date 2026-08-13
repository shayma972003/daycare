import { z } from "zod";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { protectIdNumber } from "@/lib/pii-crypto";
import { activityLogData } from "@/lib/activity-logger";
import { assertClassOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { resolveStageId, foreignStageResponse } from "@/lib/academic-stage";
import { parseAcademicStage, parseAttendanceType } from "@/lib/enum-labels";
import { ENROLLMENT_MANAGE_PERMISSION } from "@/lib/enrollment-access";
import { lockEnrollmentSubmission } from "@/lib/enrollment-atomic";
import { keyFromUrl } from "@/lib/r2";
import {
  StoredFileOwnershipError,
  transferStoredFileOwnership,
} from "@/lib/stored-files";
import { STORED_FILE_OWNER } from "@/lib/stored-file-ownership";
import { revealEnrollmentSubmissionIdNumber } from "@/lib/enrollment-submission-pii";

class EnrollmentReviewConflict extends Error {}
class EnrollmentReviewNotFound extends Error {}

const schema = z.object({
  class_id: z.string().optional(),
  full_name: z.string().min(1).optional(),
  id_number: z.string().nullish(),
  nationality: z.string().nullish(),
  academic_stage: z.string().nullish(),
  gender: z.string().nullish(),
  period: z.string().nullish(),
  date_of_birth: z.string().nullish(),
  health_condition: z.string().nullish(),
  allergies: z.string().nullish(),
  attendance_type: z.string().nullish(),
  payment_method: z.string().nullish(),
  guardian_name: z.string().nullish(),
  guardian_phone_1: z.string().nullish(),
  guardian_phone_2: z.string().nullish(),
  guardian_email: z.string().nullish(),
  guardian_name_2: z.string().nullish(),
  guardian_phone_3: z.string().nullish(),
  guardian_phone_4: z.string().nullish(),
  guardian_email_2: z.string().nullish(),
  stage_id: z.string().nullish(),
});

function mapPeriod(value: string | null | undefined): "MORNING" | "EVENING" {
  return value === "مسائي" || value === "EVENING" ? "EVENING" : "MORNING";
}

function mapPaymentMethod(value: string | null | undefined): "CASH" | "TRANSFER" | "CARD" {
  if (value === "تحويل" || value === "TRANSFER") return "TRANSFER";
  if (value === "CARD") return "CARD";
  return "CASH";
}

function mapGender(value: string | null | undefined): "MALE" | "FEMALE" {
  return value === "أنثى" || value === "FEMALE" ? "FEMALE" : "MALE";
}

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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = schema.safeParse(body);
  const overrides = parsed.success ? parsed.data : {};

  let ownedClassId: string | null;
  let ownedStageId: string | null;
  try {
    ownedClassId = await assertClassOwned(overrides.class_id || null, schoolId);
    ownedStageId = await resolveStageId(overrides.stage_id, schoolId);
  } catch (error) {
    const denied = crossTenantResponse(error);
    if (denied) return denied;
    const foreignStage = foreignStageResponse(error);
    if (foreignStage) return foreignStage;
    throw error;
  }

  try {
    const student = await prisma.$transaction(async (tx) => {
      const locked = await lockEnrollmentSubmission(tx, { id: submission_id, schoolId });
      if (!locked) throw new EnrollmentReviewNotFound();

      const submission = await tx.enrollmentSubmission.findFirst({
        where: { id: submission_id, school_id: schoolId },
      });
      if (!submission) throw new EnrollmentReviewNotFound();
      if (submission.status !== "pending_review") throw new EnrollmentReviewConflict();

      const guardianPhone = overrides.guardian_phone_1 ?? submission.guardian_phone_1;
      let guardianId: string | null = null;
      if (guardianPhone) {
        const existing = await tx.guardian.findFirst({
          where: { schoolId, phone1: guardianPhone, deletedAt: null },
        });
        if (existing) {
          guardianId = existing.id;
          await tx.guardian.updateMany({
            where: { id: existing.id, schoolId },
            data: {
              name: overrides.guardian_name ?? submission.guardian_name ?? existing.name,
              phone2: overrides.guardian_phone_2 ?? submission.guardian_phone_2 ?? existing.phone2,
              email: overrides.guardian_email ?? submission.guardian_email ?? existing.email,
              name_2: overrides.guardian_name_2 ?? submission.guardian_name_2 ?? existing.name_2,
              phone_3: overrides.guardian_phone_3 ?? submission.guardian_phone_3 ?? existing.phone_3,
              phone_4: overrides.guardian_phone_4 ?? submission.guardian_phone_4 ?? existing.phone_4,
              email_2: overrides.guardian_email_2 ?? submission.guardian_email_2 ?? existing.email_2,
            },
          });
        } else {
          const createdGuardian = await tx.guardian.create({
            data: {
              schoolId,
              name: overrides.guardian_name ?? submission.guardian_name ?? "—",
              phone1: guardianPhone,
              phone2: overrides.guardian_phone_2 ?? submission.guardian_phone_2 ?? null,
              email: overrides.guardian_email ?? submission.guardian_email ?? null,
              name_2: overrides.guardian_name_2 ?? submission.guardian_name_2 ?? null,
              phone_3: overrides.guardian_phone_3 ?? submission.guardian_phone_3 ?? null,
              phone_4: overrides.guardian_phone_4 ?? submission.guardian_phone_4 ?? null,
              email_2: overrides.guardian_email_2 ?? submission.guardian_email_2 ?? null,
            },
          });
          guardianId = createdGuardian.id;
        }
      }

      const dobRaw = overrides.date_of_birth ?? submission.date_of_birth?.toString() ?? null;
      const submissionIdNumber = revealEnrollmentSubmissionIdNumber(submission);
      const created = await tx.student.create({
        data: {
          schoolId,
          name: (overrides.full_name ?? submission.full_name) || "—",
          classId: ownedClassId,
          guardianId,
          ...protectIdNumber(overrides.id_number ?? submissionIdNumber),
          nationality: overrides.nationality ?? submission.nationality ?? null,
          academicStage: parseAcademicStage(overrides.academic_stage ?? submission.academic_stage),
          ...(ownedStageId !== null && { stageId: ownedStageId }),
          gender: mapGender(overrides.gender ?? submission.gender),
          period: mapPeriod(overrides.period ?? submission.period),
          dateOfBirth: dobRaw ? new Date(dobRaw) : null,
          healthCondition: overrides.health_condition ?? submission.health_condition ?? null,
          allergies: overrides.allergies ?? submission.allergies ?? null,
          attendanceType: parseAttendanceType(overrides.attendance_type ?? submission.attendance_type) ?? "REGULAR",
          paymentMethod: mapPaymentMethod(overrides.payment_method ?? submission.payment_method),
          paymentStatus: "PENDING",
          registrationDate: new Date(),
          enrollment_date: submission.enrollment_date ?? new Date(),
          evaluationFileUrl: submission.evaluation_file_url,
          evaluationFileName: submission.evaluation_file_name,
        },
      });

      const fileKey = keyFromUrl(submission.evaluation_file_url);
      if (fileKey) {
        await transferStoredFileOwnership(tx, {
          key: fileKey,
          schoolId,
          ownerType: STORED_FILE_OWNER.ENROLLMENT_SUBMISSION,
          ownerId: submission.id,
          nextOwnerType: STORED_FILE_OWNER.STUDENT,
          nextOwnerId: created.id,
        });
      }

      const reviewed = await tx.enrollmentSubmission.updateMany({
        where: { id: submission_id, school_id: schoolId, status: "pending_review" },
        data: { status: "approved", student_id: created.id, reviewed_at: new Date() },
      });
      if (reviewed.count !== 1) throw new EnrollmentReviewConflict();

      await tx.activityLog.create({
        data: activityLogData({
          school_id: schoolId,
          action: `تم قبول طلب تسجيل والموافقة على الطالب ${created.name}`,
          entity_type: "student",
          entity_id: created.id,
          entity_name: created.name,
          performed_by: session.user.name ?? "المدير",
          request,
        }),
      });
      return created;
    });

    return Response.json({ success: true, student_id: student.id });
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
}
