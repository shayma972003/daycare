import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  class_id: z.string().min(1).optional(),
  // allow admin to override fields before approval
  full_name: z.string().min(1).optional(),
  academic_stage: z.string().nullish(),
  gender: z.string().nullish(),
  period: z.string().nullish(),
  attendance_type: z.string().nullish(),
  payment_method: z.string().nullish(),
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
  const overrides = parsed.success ? parsed.data : {};

  const guardianPhone = sub.guardian_phone_1;
  let guardianId: string | null = null;

  if (guardianPhone) {
    const existing = await prisma.guardian.findFirst({
      where: { schoolId, phone1: guardianPhone },
    });
    if (existing) {
      guardianId = existing.id;
    } else {
      const created = await prisma.guardian.create({
        data: {
          schoolId,
          name: sub.guardian_name ?? "—",
          phone1: sub.guardian_phone_1 ?? null,
          phone2: sub.guardian_phone_2 ?? null,
          email: sub.guardian_email ?? null,
          name_2: sub.guardian_name_2 ?? null,
          phone_3: sub.guardian_phone_3 ?? null,
          phone_4: sub.guardian_phone_4 ?? null,
          email_2: sub.guardian_email_2 ?? null,
        },
      });
      guardianId = created.id;
    }
  }

  const name = (overrides.full_name ?? sub.full_name) || "—";
  const student = await prisma.student.create({
    data: {
      schoolId,
      name,
      classId: overrides.class_id ?? null,
      guardianId,
      idNumber: sub.id_number ?? null,
      nationality: sub.nationality ?? null,
      academicStage: overrides.academic_stage ?? sub.academic_stage ?? null,
      gender: mapGender(overrides.gender ?? sub.gender),
      period: mapPeriod(overrides.period ?? sub.period),
      dateOfBirth: sub.date_of_birth ?? null,
      healthCondition: sub.health_condition ?? null,
      allergies: sub.allergies ?? null,
      attendanceType: overrides.attendance_type ?? sub.attendance_type ?? "دوام منتظم",
      paymentMethod: mapPaymentMethod(overrides.payment_method ?? sub.payment_method),
      paymentStatus: "بانتظار الدفع",
      registrationDate: new Date(),
    },
  });

  await prisma.enrollmentSubmission.update({
    where: { id: submission_id },
    data: { status: "approved", student_id: student.id, reviewed_at: new Date() },
  });

  return Response.json({ success: true, student_id: student.id });
}
