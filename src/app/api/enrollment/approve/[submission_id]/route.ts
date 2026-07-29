import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";

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
});

function mapPeriod(v: string | null | undefined): "MORNING" | "EVENING" {
  return v === "مسائي" || v === "EVENING" ? "EVENING" : "MORNING";
}
function mapPaymentMethod(v: string | null | undefined): "CASH" | "TRANSFER" | "CARD" {
  if (v === "تحويل" || v === "TRANSFER") return "TRANSFER";
  if (v === "CARD") return "CARD";
  return "CASH";
}
function mapGender(v: string | null | undefined): "MALE" | "FEMALE" {
  return v === "أنثى" || v === "FEMALE" ? "FEMALE" : "MALE";
}

export async function POST(
  request: Request,
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
  if (sub.status !== "pending_review") {
    return Response.json({ error: "تم مراجعة هذا الطلب مسبقاً" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = schema.safeParse(body);
  const ov = parsed.success ? parsed.data : {};

  // Merge overrides with submission data (override wins)
  const guardianPhone = ov.guardian_phone_1 ?? sub.guardian_phone_1;
  let guardianId: string | null = null;

  if (guardianPhone) {
    const existing = await prisma.guardian.findFirst({
      where: { schoolId, phone1: guardianPhone, deletedAt: null },
    });
    if (existing) {
      guardianId = existing.id;
      // Update guardian with any new info from overrides
      await prisma.guardian.update({
        where: { id: existing.id },
        data: {
          name: ov.guardian_name ?? sub.guardian_name ?? existing.name,
          phone2: ov.guardian_phone_2 ?? sub.guardian_phone_2 ?? existing.phone2,
          email: ov.guardian_email ?? sub.guardian_email ?? existing.email,
          name_2: ov.guardian_name_2 ?? sub.guardian_name_2 ?? existing.name_2,
          phone_3: ov.guardian_phone_3 ?? sub.guardian_phone_3 ?? existing.phone_3,
          phone_4: ov.guardian_phone_4 ?? sub.guardian_phone_4 ?? existing.phone_4,
          email_2: ov.guardian_email_2 ?? sub.guardian_email_2 ?? existing.email_2,
        },
      });
    } else {
      const created = await prisma.guardian.create({
        data: {
          schoolId,
          name: ov.guardian_name ?? sub.guardian_name ?? "—",
          phone1: guardianPhone,
          phone2: ov.guardian_phone_2 ?? sub.guardian_phone_2 ?? null,
          email: ov.guardian_email ?? sub.guardian_email ?? null,
          name_2: ov.guardian_name_2 ?? sub.guardian_name_2 ?? null,
          phone_3: ov.guardian_phone_3 ?? sub.guardian_phone_3 ?? null,
          phone_4: ov.guardian_phone_4 ?? sub.guardian_phone_4 ?? null,
          email_2: ov.guardian_email_2 ?? sub.guardian_email_2 ?? null,
        },
      });
      guardianId = created.id;
    }
  }

  const dobRaw = ov.date_of_birth ?? (sub.date_of_birth ? sub.date_of_birth.toString() : null);
  const student = await prisma.student.create({
    data: {
      schoolId,
      name: (ov.full_name ?? sub.full_name) || "—",
      classId: ov.class_id || null,
      guardianId,
      idNumber: ov.id_number ?? sub.id_number ?? null,
      nationality: ov.nationality ?? sub.nationality ?? null,
      academicStage: ov.academic_stage ?? sub.academic_stage ?? null,
      gender: mapGender(ov.gender ?? sub.gender),
      period: mapPeriod(ov.period ?? sub.period),
      dateOfBirth: dobRaw ? new Date(dobRaw) : null,
      healthCondition: ov.health_condition ?? sub.health_condition ?? null,
      allergies: ov.allergies ?? sub.allergies ?? null,
      attendanceType: ov.attendance_type ?? sub.attendance_type ?? "دوام منتظم",
      paymentMethod: mapPaymentMethod(ov.payment_method ?? sub.payment_method),
      paymentStatus: "بانتظار الدفع",
      registrationDate: new Date(),
    },
  });

  await prisma.enrollmentSubmission.update({
    where: { id: submission_id },
    data: { status: "approved", student_id: student.id, reviewed_at: new Date() },
  });

  await logAction({
    school_id: schoolId,
    action: `تم قبول طلب تسجيل والموافقة على الطالب ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, student_id: student.id });
}
