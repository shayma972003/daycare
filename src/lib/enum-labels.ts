/**
 * Arabic labels for the database enums.
 *
 * The columns store stable English identifiers; the Arabic wording lives here
 * and only here. Previously the Arabic *was* the stored value in several
 * columns, which meant a copy-editing change would have been a data migration,
 * and it produced the split-vocabulary bug where the finance layer recognised
 * "PAID" and "LATE" but not "بانتظار الدفع".
 */

import type {
  PaymentStatus,
  PaymentCycleStatus,
  AdminInvoiceStatus,
  AttendanceType,
  AcademicStage,
  ClassGroup,
  Period,
  Gender,
  PaymentMethod,
  StudentStatus,
  EmploymentStatus,
  AnonymizedEntity,
  EducationLevel,
} from "@/generated/prisma/client";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "بانتظار الدفع",
  PAID: "مدفوع",
  LATE: "متأخر",
  SUSPENDED: "موقوف",
  CANCELLED: "ملغي",
};

export const PAYMENT_CYCLE_STATUS_LABELS: Record<PaymentCycleStatus, string> = {
  PENDING: "بانتظار الدفع",
  PAID: "مدفوع",
  OVERDUE: "متأخر",
  SUSPENDED: "موقف",
  CANCELLED: "ملغي",
};

export const ADMIN_INVOICE_STATUS_LABELS: Record<AdminInvoiceStatus, string> = {
  PENDING: "بانتظار الدفع",
  PAID: "مدفوع",
  OVERDUE: "متأخر",
  CANCELLED: "ملغي",
};

export const ATTENDANCE_TYPE_LABELS: Record<AttendanceType, string> = {
  REGULAR: "دوام منتظم",
  PART_TIME: "دوام جزئي",
  SHIFTS: "شفتات",
  TEMPORARY: "دوام مؤقت",
};

export const ACADEMIC_STAGE_LABELS: Record<AcademicStage, string> = {
  NURSERY: "حضانة",
  KG1: "روضة أولى",
  KG2: "روضة ثانية",
  KG3: "تمهيدي",
};

export const CLASS_GROUP_LABELS: Record<ClassGroup, string> = {
  NURSERY: "حضانة",
  KG1: "روضة أولى",
  KG2: "روضة ثانية",
  KG3: "تمهيدي",
};

export const PERIOD_LABELS: Record<Period, string> = {
  MORNING: "صباحي",
  EVENING: "مسائي",
};

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: "ذكر",
  FEMALE: "أنثى",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "نقدي",
  TRANSFER: "تحويل",
  CARD: "بطاقة",
};

/** Enrolment lifecycle — drives the retention clock, so the wording matters. */
export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  ACTIVE: "مُسجَّل",
  GRADUATED: "متخرّج",
  WITHDRAWN: "منسحب",
  TRANSFERRED: "منقول",
};

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  ACTIVE: "على رأس العمل",
  RESIGNED: "مستقيل",
  TERMINATED: "منتهية خدماته",
  CONTRACT_ENDED: "انتهى العقد",
};

export const ANONYMIZED_ENTITY_LABELS: Record<AnonymizedEntity, string> = {
  STUDENT: "طفل",
  TEACHER: "موظف",
  GUARDIAN: "ولي أمر",
};

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  HIGH_SCHOOL: "ثانوي",
  DIPLOMA: "دبلوم",
  BACHELOR: "بكالوريوس",
  MASTER: "ماجستير",
  PHD: "دكتوراه",
  OTHER: "أخرى",
};

/**
 * Suggested job titles (task 2.39).
 *
 * A datalist, not a `<select>`: the column is free text on purpose, because a
 * nursery's own words for its posts vary and an enum would force "مساعدة معلمة"
 * into whichever option fits worst. These are the common ones, offered as
 * autocomplete so most entries land on a consistent spelling anyway.
 */
export const JOB_TITLE_SUGGESTIONS = [
  "مديرة",
  "مساعدة مديرة",
  "معلمة",
  "مساعدة معلمة",
  "معلمة تربية خاصة",
  "معلمة طفولة مبكرة",
  "أخصائية نفسية",
  "ممرضة",
  "موارد بشرية",
  "محاسبة",
  "إدارية",
  "مشرفة",
  "عاملة",
  "سائق",
  "حارس",
];

/** Common specialisations, offered the same way and for the same reason. */
export const SPECIALIZATION_SUGGESTIONS = [
  "طفولة مبكرة",
  "تربية خاصة",
  "رياض أطفال",
  "علم نفس",
  "لغة عربية",
  "لغة إنجليزية",
  "تربية بدنية",
  "تغذية",
  "تمريض",
  "إدارة أعمال",
  "محاسبة",
];

/** Shapes a label map into the `{ value, label }` list that selects expect. */
export function toOptions<T extends string>(labels: Record<T, string>) {
  return (Object.entries(labels) as [T, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}

/**
 * Maps legacy free-text values onto the enum.
 *
 * Imports and older rows carry Arabic wording, and the enrolment flow wrote
 * "بانتظار الدفع" directly. Keeps those inputs working rather than rejecting them.
 */
const LEGACY_PAYMENT_STATUS: Record<string, PaymentStatus> = {
  "بانتظار الدفع": "PENDING",
  "قيد الانتظار": "PENDING",
  "مدفوع": "PAID",
  "متأخر": "LATE",
  "موقوف": "SUSPENDED",
  "موقف": "SUSPENDED",
  "ملغي": "CANCELLED",
  "ملغى": "CANCELLED",
};

export function parsePaymentStatus(value: string | null | undefined): PaymentStatus | null {
  if (!value) return null;

  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (upper in PAYMENT_STATUS_LABELS) return upper as PaymentStatus;

  return LEGACY_PAYMENT_STATUS[trimmed] ?? null;
}

const LEGACY_ATTENDANCE_TYPE: Record<string, AttendanceType> = {
  "دوام منتظم": "REGULAR",
  "منتظم": "REGULAR",
  "دوام جزئي": "PART_TIME",
  "جزئي": "PART_TIME",
  "شفتات": "SHIFTS",
  "دوام شفتات": "SHIFTS",
  "دوام مؤقت": "TEMPORARY",
  "مؤقت": "TEMPORARY",
};

export function parseAttendanceType(value: string | null | undefined): AttendanceType | null {
  if (!value) return null;

  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (upper in ATTENDANCE_TYPE_LABELS) return upper as AttendanceType;

  return LEGACY_ATTENDANCE_TYPE[trimmed] ?? null;
}

/** Includes the spellings found in live rows, not just the tidy ones. */
const LEGACY_STAGE: Record<string, AcademicStage> = {
  "حضانة": "NURSERY",
  "الحضانة": "NURSERY",
  "nursery": "NURSERY",
  "kg1": "KG1",
  "كي جي 1": "KG1",
  "كيجي 1": "KG1",
  "روضة أولى": "KG1",
  "الروضة": "KG1",
  "kg2": "KG2",
  "كي جي 2": "KG2",
  "كيجي 2": "KG2",
  "روضة ثانية": "KG2",
  "kg3": "KG3",
  "كي جي 3": "KG3",
  "كيجي 3": "KG3",
  "تمهيدي": "KG3",
};

export function parseAcademicStage(value: string | null | undefined): AcademicStage | null {
  if (!value) return null;

  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (upper in ACADEMIC_STAGE_LABELS) return upper as AcademicStage;

  return LEGACY_STAGE[trimmed.toLowerCase()] ?? LEGACY_STAGE[trimmed] ?? null;
}

export function parseClassGroup(value: string | null | undefined): ClassGroup | null {
  const stage = parseAcademicStage(value);
  return stage as ClassGroup | null;
}
