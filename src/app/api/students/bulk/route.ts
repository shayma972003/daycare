import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { parseAcademicStage } from "@/lib/enum-labels";
import { z } from "zod";
import * as XLSX from "xlsx";

// Expected Excel column headers (Arabic):
// الاسم | الحالة الصحية | المرحلة الدراسية | الفترة | رقم الهوية | تاريخ الميلاد | الجنسية | الجنس
// اسم ولي الأمر | الهاتف 1 | الهاتف 2 | البريد الإلكتروني | طريقة الدفع | حالة الدفع | الحساسيات

const rowSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب"),
  healthCondition: z.string().optional(),
  academicStage: z.string().optional(),
  period: z.enum(["MORNING", "EVENING"]).default("MORNING"),
  idNumber: z.string().optional(),
  dateOfBirth: z.string().optional(),
  nationality: z.string().optional(),
  gender: z.enum(["MALE", "FEMALE"]).default("MALE"),
  guardianName: z.string().optional(),
  phone1: z.string().optional(),
  phone2: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]).default("CASH"),
  paymentStatus: z.enum(["PAID", "LATE", "CANCELLED", "SUSPENDED"]).default("PAID"),
  allergies: z.string().optional(),
});

function mapRow(raw: Record<string, unknown>) {
  const periodMap: Record<string, string> = { صباحي: "MORNING", مسائي: "EVENING", MORNING: "MORNING", EVENING: "EVENING" };
  const genderMap: Record<string, string> = { ذكر: "MALE", أنثى: "FEMALE", MALE: "MALE", FEMALE: "FEMALE" };
  const payMethodMap: Record<string, string> = { نقدي: "CASH", تحويل: "TRANSFER", بطاقة: "CARD", CASH: "CASH", TRANSFER: "TRANSFER", CARD: "CARD" };
  const payStatusMap: Record<string, string> = { مدفوع: "PAID", متأخر: "LATE", ملغي: "CANCELLED", موقف: "SUSPENDED", PAID: "PAID", LATE: "LATE", CANCELLED: "CANCELLED", SUSPENDED: "SUSPENDED" };

  return {
    name: String(raw["الاسم"] ?? raw["name"] ?? "").trim(),
    healthCondition: String(raw["الحالة الصحية"] ?? raw["healthCondition"] ?? "").trim() || undefined,
    academicStage: String(raw["المرحلة الدراسية"] ?? raw["academicStage"] ?? "").trim() || undefined,
    period: periodMap[String(raw["الفترة"] ?? raw["period"] ?? "").trim()] ?? "MORNING",
    idNumber: String(raw["رقم الهوية"] ?? raw["idNumber"] ?? "").trim() || undefined,
    dateOfBirth: String(raw["تاريخ الميلاد"] ?? raw["dateOfBirth"] ?? "").trim() || undefined,
    nationality: String(raw["الجنسية"] ?? raw["nationality"] ?? "").trim() || undefined,
    gender: genderMap[String(raw["الجنس"] ?? raw["gender"] ?? "").trim()] ?? "MALE",
    guardianName: String(raw["اسم ولي الأمر"] ?? raw["guardianName"] ?? "").trim() || undefined,
    phone1: String(raw["الهاتف 1"] ?? raw["phone1"] ?? "").trim() || undefined,
    phone2: String(raw["الهاتف 2"] ?? raw["phone2"] ?? "").trim() || undefined,
    email: String(raw["البريد الإلكتروني"] ?? raw["email"] ?? "").trim() || undefined,
    paymentMethod: payMethodMap[String(raw["طريقة الدفع"] ?? raw["paymentMethod"] ?? "").trim()] ?? "CASH",
    paymentStatus: payStatusMap[String(raw["حالة الدفع"] ?? raw["paymentStatus"] ?? "").trim()] ?? "PAID",
    allergies: String(raw["الحساسيات"] ?? raw["allergies"] ?? "").trim() || undefined,
  };
}

export async function POST(request: Request) {
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
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "No file" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

  const valid: ReturnType<typeof rowSchema.parse>[] = [];
  const errors: string[] = [];

  rows.forEach((raw, i) => {
    const mapped = mapRow(raw);
    const parsed = rowSchema.safeParse(mapped);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      const msgs = parsed.error.issues.map((e) => e.message).join(", ");
      errors.push(`صف ${i + 2}: ${msgs}`);
    }
  });

  let added = 0;

  for (const v of valid) {
    // Guardian deduplication per row
    let guardianId: string | null = null;

    if (v.guardianName) {
      const orConditions: { phone1?: string; email?: string }[] = [];
      if (v.phone1) orConditions.push({ phone1: v.phone1 });
      if (v.email) orConditions.push({ email: v.email });

      let guardian = orConditions.length > 0
        ? await prisma.guardian.findFirst({ where: { schoolId, deletedAt: null, OR: orConditions } })
        : null;

      if (!guardian) {
        guardian = await prisma.guardian.create({
          data: {
            schoolId,
            name: v.guardianName,
            phone1: v.phone1 ?? null,
            phone2: v.phone2 ?? null,
            email: v.email || null,
          },
        });
      }
      guardianId = guardian.id;
    }

    await prisma.student.create({
      data: {
        schoolId,
        name: v.name,
        healthCondition: v.healthCondition ?? null,
        academicStage: parseAcademicStage(v.academicStage),
        period: v.period as "MORNING" | "EVENING",
        idNumber: v.idNumber ?? null,
        dateOfBirth: v.dateOfBirth ? new Date(v.dateOfBirth) : null,
        nationality: v.nationality ?? null,
        gender: v.gender as "MALE" | "FEMALE",
        guardianId,
        paymentMethod: v.paymentMethod as "CASH" | "TRANSFER" | "CARD",
        paymentStatus: v.paymentStatus as "PAID" | "LATE" | "CANCELLED" | "SUSPENDED",
        allergies: v.allergies ?? null,
      },
    });
    added++;
  }

  await logAction({
    school_id: schoolId,
    action: `تأكيد استيراد الطلاب: ${added} طالب مستورد`,
    entity_type: "import",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ added, failed: errors.length, errors });
}
