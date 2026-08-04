/**
 * Form validation shared by the browser and the API (task 2.41).
 *
 * Rule 7 in CLAUDE.md requires Zod on every form; only the registration page had
 * it. The rest validated by whatever the input element happened to enforce,
 * which is nothing on a text field and easily bypassed on the others — so the
 * API was the only real check, and the user learned about a problem after a
 * round trip instead of while typing.
 *
 * Defined once here and imported by both sides. A client schema that drifts from
 * the server's produces the worst outcome of all: a form that accepts input the
 * route then rejects, with an error the form was never designed to show.
 */

import { z } from "zod";

/**
 * A Saudi mobile number in any of the forms people actually type.
 *
 * Accepts `05xxxxxxxx`, `5xxxxxxxx`, `+9665xxxxxxxx` and `009665xxxxxxxx`, plus
 * spaces and dashes, because rejecting a number a parent wrote correctly for a
 * human is how a nursery ends up storing it in the notes field instead.
 * Normalisation to one stored form happens server-side in `phone-normalizer`.
 */
export const saudiPhone = z
  .string()
  .trim()
  .regex(
    /^(?:\+?966|00966|0)?[\s-]?5[\s-]?\d(?:[\s-]?\d){7}$/,
    "رقم الجوال غير صحيح"
  );

/** Optional phone: empty string is "not provided", not "invalid". */
export const optionalPhone = z
  .union([z.literal(""), saudiPhone])
  .optional()
  .nullable();

export const optionalEmail = z
  .union([z.literal(""), z.string().email("البريد الإلكتروني غير صالح")])
  .optional()
  .nullable();

/** `<input type="date">` gives "YYYY-MM-DD" or "" — never a Date. */
export const optionalDate = z
  .union([
    z.literal(""),
    z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "التاريخ غير صحيح",
    }),
  ])
  .optional()
  .nullable();

/**
 * The Saudi national ID / iqama: exactly ten digits.
 *
 * Length only. The check-digit algorithm would reject a valid residency number
 * whose format the nursery has correctly copied off the card, and a data-entry
 * screen is the wrong place to be more certain than the document.
 */
export const optionalNationalId = z
  .union([z.literal(""), z.string().regex(/^\d{10}$/, "رقم الهوية 10 أرقام")])
  .optional()
  .nullable();

/**
 * A monetary amount from a form field.
 *
 * Accepts both a string and a number because the forms differ: some register the
 * input plainly (giving a string) and some with `valueAsNumber` (giving a
 * number). Insisting on one would mean rewriting whichever forms disagree, which
 * is a larger and riskier change than accepting both here — and both are equally
 * valid representations of the same amount.
 */
export const optionalMoney = z
  .union([
    z.literal(""),
    z.number().min(0, "المبلغ غير صحيح"),
    z
      .string()
      .refine((value) => !Number.isNaN(Number(value)) && Number(value) >= 0, {
        message: "المبلغ غير صحيح",
      }),
  ])
  .optional()
  .nullable();

export const studentFormSchema = z
  .object({
    name: z.string().trim().min(2, "اسم الطفل مطلوب"),
    classId: z.string().optional().nullable(),
    healthCondition: z.string().max(500).optional().nullable(),
    allergies: z.string().max(500).optional().nullable(),
    /** The school's own academic stage (task 2.44) — an id, not free text. */
    stageId: z.string().optional().nullable(),
    period: z.enum(["MORNING", "EVENING"]).optional(),
    idNumber: optionalNationalId,
    dateOfBirth: optionalDate,
    nationality: z.string().max(60).optional().nullable(),
    gender: z.enum(["MALE", "FEMALE"]).optional(),
    attendanceType: z.string().optional().nullable(),
    paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]).optional(),
    paymentStatus: z.string().optional().nullable(),
    enrollmentDate: optionalDate,
    enrollmentEndDate: optionalDate,
    registrationFee: optionalMoney,

    guardianName: z.string().trim().max(120).optional().nullable(),
    guardianPhone1: optionalPhone,
    guardianPhone2: optionalPhone,
    guardianEmail: optionalEmail,
    guardianName2: z.string().trim().max(120).optional().nullable(),
    guardianPhone3: optionalPhone,
    guardianPhone4: optionalPhone,
    guardianEmail2: optionalEmail,
  })
  .refine(
    (data) =>
      !data.enrollmentDate ||
      !data.enrollmentEndDate ||
      new Date(data.enrollmentEndDate) >= new Date(data.enrollmentDate),
    {
      message: "تاريخ نهاية التسجيل يجب أن يكون بعد تاريخ البداية",
      path: ["enrollmentEndDate"],
    }
  )
  .refine(
    (data) => !data.dateOfBirth || new Date(data.dateOfBirth) <= new Date(),
    { message: "تاريخ الميلاد لا يمكن أن يكون في المستقبل", path: ["dateOfBirth"] }
  );

export type StudentFormValues = z.infer<typeof studentFormSchema>;

export const teacherFormSchema = z
  .object({
    name: z.string().trim().min(2, "اسم الموظف مطلوب"),
    period: z.enum(["MORNING", "EVENING"]).optional(),
    classId: z.string().optional().nullable(),
    idNumber: optionalNationalId,
    dateOfBirth: optionalDate,
    nationality: z.string().max(60).optional().nullable(),
    email: optionalEmail,
    phone1: optionalPhone,
    phone2: optionalPhone,
    paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]).optional(),
    joinDate: optionalDate,
    enrollmentEndDate: optionalDate,
    monthlySalary: optionalMoney,
    lateDeductionRate: optionalMoney,
    // Task 2.39.
    jobTitle: z.string().trim().max(80).optional().nullable(),
    educationLevel: z
      .union([
        z.literal(""),
        z.enum(["HIGH_SCHOOL", "DIPLOMA", "BACHELOR", "MASTER", "PHD", "OTHER"]),
      ])
      .optional()
      .nullable(),
    specialization: z.string().trim().max(120).optional().nullable(),

    // The ten free-text qualification lines. Listed explicitly rather than left
    // to a passthrough: the forms declare them, and a schema that silently drops
    // a field the form collects is the exact failure this task exists to remove.
    qualification1: z.string().max(200).optional().nullable(),
    qualification2: z.string().max(200).optional().nullable(),
    qualification3: z.string().max(200).optional().nullable(),
    qualification4: z.string().max(200).optional().nullable(),
    qualification5: z.string().max(200).optional().nullable(),
    qualification6: z.string().max(200).optional().nullable(),
    qualification7: z.string().max(200).optional().nullable(),
    qualification8: z.string().max(200).optional().nullable(),
    qualification9: z.string().max(200).optional().nullable(),
    qualification10: z.string().max(200).optional().nullable(),
  })
  .refine(
    (data) => !data.dateOfBirth || new Date(data.dateOfBirth) <= new Date(),
    { message: "تاريخ الميلاد لا يمكن أن يكون في المستقبل", path: ["dateOfBirth"] }
  )
  .refine(
    (data) =>
      !data.joinDate ||
      !data.enrollmentEndDate ||
      new Date(data.enrollmentEndDate) >= new Date(data.joinDate),
    {
      message: "تاريخ نهاية العقد يجب أن يكون بعد تاريخ الانضمام",
      path: ["enrollmentEndDate"],
    }
  );

export type TeacherFormValues = z.infer<typeof teacherFormSchema>;

export const settingsFormSchema = z.object({
  schoolName: z.string().trim().min(1, "اسم المنشأة مطلوب"),
  email: optionalEmail,
  hourlyLateFee: optionalMoney,
  dailyStudentFee: optionalMoney,
  monthlyStudentFee: optionalMoney,
  // "HH:mm" as produced by `<input type="time">`.
  teacherCheckinTime: z.string().optional().nullable(),
  teacherCheckoutTime: z.string().optional().nullable(),
  studentCheckinTime: z.string().optional().nullable(),
  studentCheckoutTime: z.string().optional().nullable(),
  commercialRegistration: z.string().max(40).optional().nullable(),
  vatNumber: z.string().max(40).optional().nullable(),
  contactNumber: optionalPhone,
  phoneNumber: optionalPhone,
  address: z.string().max(300).optional().nullable(),
});

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;
