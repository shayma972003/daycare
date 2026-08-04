import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";
import * as XLSX from "xlsx";

// Expected Excel column headers (Arabic):
// الاسم | الفترة | رقم الهوية | تاريخ الميلاد | الجنسية | البريد الإلكتروني
// الهاتف 1 | الهاتف 2 | المؤهل 1 | طريقة الدفع | تاريخ الانضمام | الراتب الشهري | نسبة الخصم

const rowSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب"),
  period: z.enum(["MORNING", "EVENING"]).default("MORNING"),
  idNumber: z.string().optional(),
  dateOfBirth: z.string().optional(),
  nationality: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone1: z.string().optional(),
  phone2: z.string().optional(),
  qualification1: z.string().optional(),
  paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]).default("CASH"),
  joinDate: z.string().optional(),
  // An imported spreadsheet is the least trustworthy source in the product.
  monthlySalary: z.number().min(0).max(1_000_000).default(0),
  lateDeductionRate: z.number().min(0).max(100).default(0),
});

function mapRow(raw: Record<string, unknown>) {
  const periodMap: Record<string, string> = { صباحي: "MORNING", مسائي: "EVENING", MORNING: "MORNING", EVENING: "EVENING" };
  const payMethodMap: Record<string, string> = { نقدي: "CASH", تحويل: "TRANSFER", بطاقة: "CARD", CASH: "CASH", TRANSFER: "TRANSFER", CARD: "CARD" };

  return {
    name: String(raw["الاسم"] ?? raw["name"] ?? "").trim(),
    period: periodMap[String(raw["الفترة"] ?? raw["period"] ?? "").trim()] ?? "MORNING",
    idNumber: String(raw["رقم الهوية"] ?? raw["idNumber"] ?? "").trim() || undefined,
    dateOfBirth: String(raw["تاريخ الميلاد"] ?? raw["dateOfBirth"] ?? "").trim() || undefined,
    nationality: String(raw["الجنسية"] ?? raw["nationality"] ?? "").trim() || undefined,
    email: String(raw["البريد الإلكتروني"] ?? raw["email"] ?? "").trim() || undefined,
    phone1: String(raw["الهاتف 1"] ?? raw["phone1"] ?? "").trim() || undefined,
    phone2: String(raw["الهاتف 2"] ?? raw["phone2"] ?? "").trim() || undefined,
    qualification1: String(raw["المؤهل 1"] ?? raw["qualification1"] ?? "").trim() || undefined,
    paymentMethod: payMethodMap[String(raw["طريقة الدفع"] ?? raw["paymentMethod"] ?? "").trim()] ?? "CASH",
    joinDate: String(raw["تاريخ الانضمام"] ?? raw["joinDate"] ?? "").trim() || undefined,
    monthlySalary: parseFloat(String(raw["الراتب الشهري"] ?? raw["monthlySalary"] ?? "0")) || 0,
    lateDeductionRate: parseFloat(String(raw["نسبة الخصم"] ?? raw["lateDeductionRate"] ?? "0")) || 0,
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

  if (valid.length > 0) {
    await prisma.teacher.createMany({
      data: valid.map((v) => ({
        schoolId,
        name: v.name,
        period: v.period as "MORNING" | "EVENING",
        idNumber: v.idNumber ?? null,
        dateOfBirth: v.dateOfBirth ? new Date(v.dateOfBirth) : null,
        nationality: v.nationality ?? null,
        email: v.email || null,
        phone1: v.phone1 ?? null,
        phone2: v.phone2 ?? null,
        qualification1: v.qualification1 ?? null,
        paymentMethod: v.paymentMethod as "CASH" | "TRANSFER" | "CARD",
        joinDate: v.joinDate ? new Date(v.joinDate) : new Date(),
        monthlySalary: v.monthlySalary,
        lateDeductionRate: v.lateDeductionRate,
      })),
      skipDuplicates: true,
    });
  }

  await logAction({
    school_id: schoolId,
    action: `تأكيد استيراد المعلمين: ${valid.length} معلم مستورد`,
    entity_type: "import",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ added: valid.length, failed: errors.length, errors });
}
