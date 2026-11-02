import {
  ASSIGNABLE_ROLE_KEYS,
  isAssignableRoleKey,
  type AssignableRoleKey,
} from "@/lib/permissions";

/**
 * Stable values stored on the employee record.
 *
 * They intentionally match the account-role keys so the employee's job title
 * and a later app-account invitation cannot drift into two different roles.
 * Creating an employee still does not create an account automatically.
 */
export const EMPLOYEE_JOB_TITLE_VALUES = ASSIGNABLE_ROLE_KEYS;

export const EMPLOYEE_JOB_TITLE_LABEL_KEYS: Record<AssignableRoleKey, string> = {
  admin_assistant: "employeeRoles.admin_assistant",
  teacher: "employeeRoles.teacher",
  teacher_assistant: "employeeRoles.teacher_assistant",
  accountant: "employeeRoles.accountant",
  hr: "employeeRoles.hr",
};

export const EDUCATION_LEVEL_VALUES = [
  "HIGH_SCHOOL",
  "DIPLOMA",
  "BACHELOR",
  "MASTER",
  "PHD",
  "OTHER",
] as const;

export type EducationLevelValue = (typeof EDUCATION_LEVEL_VALUES)[number];

export const EDUCATION_LEVEL_LABEL_KEYS: Record<EducationLevelValue, string> = {
  HIGH_SCHOOL: "educationLevels.HIGH_SCHOOL",
  DIPLOMA: "educationLevels.DIPLOMA",
  BACHELOR: "educationLevels.BACHELOR",
  MASTER: "educationLevels.MASTER",
  PHD: "educationLevels.PHD",
  OTHER: "educationLevels.OTHER",
};

const LEGACY_JOB_TITLES: Record<string, AssignableRoleKey> = {
  "مساعد إداري": "admin_assistant",
  "مساعدة إدارية": "admin_assistant",
  "مساعدة مديرة": "admin_assistant",
  "إدارية": "admin_assistant",
  "مشرفة": "admin_assistant",
  "معلم": "teacher",
  "معلمة": "teacher",
  "معلمة تربية خاصة": "teacher",
  "معلمة طفولة مبكرة": "teacher",
  "مساعد معلم": "teacher_assistant",
  "مساعدة معلمة": "teacher_assistant",
  "محاسب": "accountant",
  "محاسبة": "accountant",
  "موارد بشرية": "hr",
};

/** Maps existing free-text job titles into the fixed role picker. */
export function normalizeEmployeeJobTitle(
  value: string | null | undefined
): AssignableRoleKey | "" {
  const normalized = value?.trim();
  if (!normalized) return "";
  if (isAssignableRoleKey(normalized)) return normalized;
  return LEGACY_JOB_TITLES[normalized] ?? "";
}
