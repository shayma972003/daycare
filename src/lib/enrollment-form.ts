import { z } from "zod";
import { optionalEmail, saudiPhone } from "@/lib/form-schemas";
import { normalizeNumerals } from "@/lib/phone-normalizer";

const requiredText = (message: string, max = 500) =>
  z.string().trim().min(1, message).max(max, message);

const requiredDate = (message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00+03:00`).getTime()), {
      message: "التاريخ غير صحيح",
    });

const nationalId = z.preprocess(
  (value) => (typeof value === "string" ? normalizeNumerals(value).trim() : value),
  z.string().regex(/^\d{10}$/, "رقم الهوية أو الإقامة يجب أن يتكون من 10 أرقام")
);

/**
 * The public enrolment contract shared by the page and its API.
 *
 * Legacy database columns are deliberately not represented here. Removing a
 * field from new submissions must not erase historical data already approved
 * into a student's record.
 */
export const publicEnrollmentFormSchema = z.object({
  full_name: requiredText("الاسم الكامل مطلوب", 160),
  id_number: nationalId,
  nationality: requiredText("الجنسية مطلوبة", 60),
  gender: z.enum(["ذكر", "أنثى"], { message: "الجنس مطلوب" }),
  period: z.enum(["صباحي", "مسائي"], { message: "الفترة مطلوبة" }),
  date_of_birth: requiredDate("تاريخ الميلاد مطلوب").refine(
    (value) => new Date(`${value}T12:00:00+03:00`) <= new Date(),
    "تاريخ الميلاد لا يمكن أن يكون في المستقبل"
  ),
  health_condition: requiredText("الحالة الصحية مطلوبة"),
  allergies: requiredText("الحساسيات والتنبيهات مطلوبة"),
  payment_method: z.enum(["نقدي", "تحويل"], { message: "طريقة الدفع مطلوبة" }),
  enrollment_date: requiredDate("تاريخ الانضمام مطلوب"),
  evaluation_file_url: z.string().trim().min(1).optional(),
  evaluation_file_name: z.string().trim().min(1).optional(),
  guardian_name: requiredText("اسم ولي الأمر مطلوب", 120),
  guardian_phone_1: saudiPhone,
  guardian_phone_2: saudiPhone,
  guardian_email: z.string().trim().email("البريد الإلكتروني غير صالح"),
  guardian_name_2: requiredText("اسم ولي الأمر 2 مطلوب", 120),
  guardian_email_2: optionalEmail,
});

export type PublicEnrollmentForm = z.infer<typeof publicEnrollmentFormSchema>;
