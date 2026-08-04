import { prisma } from "@/lib/prisma";
import { z } from "zod";
// Was a second, laxer copy of this that turned "12" into "+96612". One
// implementation, one set of rules.
import { normalizePhone } from "@/lib/phone-normalizer";
import { astDayStart } from "@/lib/datetime";

const schema = z.object({
  token: z.string().min(1),
  full_name: z.string().min(1),
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
  enrollment_date: z.string().nullish(),
  evaluation_file_url: z.string().nullish(),
  evaluation_file_name: z.string().nullish(),
  guardian_name: z.string().nullish(),
  guardian_phone_1: z.string().nullish(),
  guardian_phone_2: z.string().nullish(),
  guardian_email: z.string().nullish(),
  guardian_name_2: z.string().nullish(),
  guardian_phone_3: z.string().nullish(),
  guardian_phone_4: z.string().nullish(),
  guardian_email_2: z.string().nullish(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() }, { status: 422 });
  }

  const { token, ...formData } = parsed.data;

  const rec = await prisma.enrollmentToken.findUnique({ where: { token } });

  if (!rec) return Response.json({ error: "invalid" }, { status: 404 });
  if (!rec.otp_verified) return Response.json({ error: "لم يتم التحقق من الرمز" }, { status: 403 });
  if (rec.expires_at < new Date()) return Response.json({ error: "expired" }, { status: 410 });
  if (rec.submissions_count >= rec.max_submissions) {
    return Response.json({
      error: `لقد وصلت إلى الحد الأقصى المسموح به (${rec.max_submissions} أطفال)`,
      limit_reached: true,
    }, { status: 429 });
  }

  const newCount = rec.submissions_count + 1;

  const submission = await prisma.enrollmentSubmission.create({
    data: {
      token_id: rec.id,
      school_id: rec.school_id,
      full_name: formData.full_name,
      id_number: formData.id_number ?? null,
      nationality: formData.nationality ?? null,
      academic_stage: formData.academic_stage ?? null,
      gender: formData.gender ?? null,
      period: formData.period ?? null,
      date_of_birth: formData.date_of_birth ? new Date(formData.date_of_birth) : null,
      health_condition: formData.health_condition ?? null,
      allergies: formData.allergies ?? null,
      attendance_type: formData.attendance_type ?? null,
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
      guardian_phone_3: normalizePhone(formData.guardian_phone_3),
      guardian_phone_4: normalizePhone(formData.guardian_phone_4),
      guardian_email_2: formData.guardian_email_2 ?? null,
    },
  });

  await prisma.enrollmentToken.update({
    where: { token },
    data: {
      submissions_count: newCount,
      ...(newCount >= rec.max_submissions ? { status: "completed" } : {}),
    },
  });

  // In-app notification log for admin
  await prisma.notificationLog.create({
    data: {
      schoolId: rec.school_id,
      recipientName: formData.full_name,
      type: "WHATSAPP",
      content: `طلب تسجيل جديد: ${formData.full_name} — في انتظار المراجعة`,
      status: "SENT",
      source: "enrollment",
    },
  });

  return Response.json({
    success: true,
    submission_id: submission.id,
    submissions_count: newCount,
    limit_reached: newCount >= rec.max_submissions,
    max_submissions: rec.max_submissions,
  });
}
