import { prisma } from "@/lib/prisma";
// Was a second, laxer copy of this that turned "12" into "+96612". One
// implementation, one set of rules.
import { normalizePhone } from "@/lib/phone-normalizer";
import { astDayStart } from "@/lib/datetime";
import { keyFromUrl, schoolIdFromKey } from "@/lib/r2";
import { rateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import {
  StoredFileOwnershipError,
  transferStoredFileOwnership,
} from "@/lib/stored-files";
import { STORED_FILE_OWNER } from "@/lib/stored-file-ownership";
import { reserveEnrollmentSlot } from "@/lib/enrollment-atomic";
import { protectEnrollmentSubmissionIdNumber } from "@/lib/enrollment-submission-pii";
import { publicEnrollmentFormSchema } from "@/lib/enrollment-form";
import { z } from "zod";

class EnrollmentSlotUnavailable extends Error {}

const schema = publicEnrollmentFormSchema.extend({ token: z.string().min(1) });

export async function POST(request: Request) {
  const limited = await rateLimit({
    key: `enroll:submit:${clientIp(request)}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limited);
  if (limitedResponse) return limitedResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة",
        details: parsed.error.flatten(),
      },
      { status: 422 }
    );
  }

  const { token, ...formData } = parsed.data;

  const rec = await prisma.enrollmentToken.findUnique({ where: { token } });

  if (!rec) return Response.json({ error: "invalid" }, { status: 404 });
  if (rec.expires_at < new Date()) return Response.json({ error: "expired" }, { status: 410 });
  if (rec.submissions_count >= rec.max_submissions) {
    return Response.json({
      error: `لقد وصلت إلى الحد الأقصى المسموح به (${rec.max_submissions} أطفال)`,
      limit_reached: true,
    }, { status: 429 });
  }

  /**
   * The evaluation file must be one this endpoint's sibling just stored.
   *
   * It arrives as a URL from a form with no session behind it, so left
   * unchecked the field is a way to write any string into a school's record —
   * a link to somewhere else, or a path into another tenant's files. Only a key
   * inside this school's own prefix is accepted; anything else, including the
   * base64 data URIs older links used to send, is refused.
   */
  const evaluationFileKey = formData.evaluation_file_url
    ? keyFromUrl(formData.evaluation_file_url)
    : null;
  if (formData.evaluation_file_url) {
    if (!evaluationFileKey || schoolIdFromKey(evaluationFileKey) !== rec.school_id) {
      return Response.json({ error: "ملف التقييم غير صالح" }, { status: 422 });
    }
  }

  let protectedIdNumber;
  try {
    protectedIdNumber = protectEnrollmentSubmissionIdNumber(formData.id_number);
  } catch {
    return Response.json(
      { error: "Enrollment submission is temporarily unavailable" },
      { status: 503 }
    );
  }

  let submission;
  let reservation;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const reserved = await reserveEnrollmentSlot(tx, {
        id: rec.id,
        token,
        schoolId: rec.school_id,
        now: new Date(),
      });
      if (!reserved) throw new EnrollmentSlotUnavailable();

      const created = await tx.enrollmentSubmission.create({
        data: {
      token_id: rec.id,
      school_id: rec.school_id,
      full_name: formData.full_name,
      ...protectedIdNumber,
      nationality: formData.nationality ?? null,
      gender: formData.gender ?? null,
      period: formData.period ?? null,
      date_of_birth: formData.date_of_birth ? new Date(formData.date_of_birth) : null,
      health_condition: formData.health_condition ?? null,
      allergies: formData.allergies ?? null,
      payment_method: formData.payment_method ?? null,
      /**
       * Anchored to the Riyadh business day the parent picked.
       *
       * The form now sends a bare `yyyy-mm-dd`, and `new Date("2026-08-04")`
       * would parse it as midnight UTC — a different instant from the one the
       * rest of the system means by that date. `astDayStart` puts it on the same
       * boundary attendance rows and the retention clock use.
       */
      enrollment_date: astDayStart(
        formData.enrollment_date ? new Date(`${formData.enrollment_date}T12:00:00+03:00`) : new Date()
      ),
      evaluation_file_url: formData.evaluation_file_url ?? null,
      evaluation_file_name: formData.evaluation_file_name ?? null,
      guardian_name: formData.guardian_name ?? null,
      guardian_phone_1: normalizePhone(formData.guardian_phone_1),
      guardian_phone_2: normalizePhone(formData.guardian_phone_2),
      guardian_email: formData.guardian_email ?? null,
      guardian_name_2: formData.guardian_name_2 ?? null,
      guardian_email_2: formData.guardian_email_2 ?? null,
        },
      });

      if (evaluationFileKey) {
        await transferStoredFileOwnership(tx, {
          key: evaluationFileKey,
          schoolId: rec.school_id,
          ownerType: STORED_FILE_OWNER.ENROLLMENT_TOKEN,
          ownerId: rec.id,
          nextOwnerType: STORED_FILE_OWNER.ENROLLMENT_SUBMISSION,
          nextOwnerId: created.id,
        });
      }

      return { submission: created, reservation: reserved };
    });
    submission = result.submission;
    reservation = result.reservation;
  } catch (error) {
    if (error instanceof EnrollmentSlotUnavailable) {
      return Response.json(
        { error: "Enrollment submission is unavailable", limit_reached: true },
        { status: 429 }
      );
    }
    if (error instanceof StoredFileOwnershipError) {
      return Response.json({ error: "Invalid evaluation file" }, { status: 422 });
    }
    throw error;
  }

  return Response.json({
    success: true,
    submission_id: submission.id,
    submissions_count: reservation.submissionsCount,
    limit_reached: reservation.submissionsCount >= reservation.maxSubmissions,
    max_submissions: reservation.maxSubmissions,
  });
}
