/**
 * The permission catalogue and the role templates built from it.
 *
 * Permissions live in code, not in a database table. They are a property of the
 * release — a new screen ships with a new key — so storing them as rows would
 * mean every deploy needs a data migration, and a row that drifts out of step
 * with the code is a permission the UI can grant but nothing enforces. What is
 * *data* is which permissions a given school's role holds, and that is the only
 * thing the database stores.
 *
 * Keys are `category.action` and are permanent: they are written into
 * `Role.permissions` on live rows, so renaming one silently revokes access.
 */

export const PERMISSION_CATEGORIES = [
  "auth",
  "staff",
  "students",
  "classes",
  "units",
  "schedule",
  "attendance",
  "finance",
  "settings",
] as const;

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export interface PermissionDefinition {
  key: string;
  category: PermissionCategory;
  labelAr: string;
  /** Shown under the checkbox where the wording alone is ambiguous. */
  hintAr?: string;
}

export const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  auth: "تسجيل الدخول",
  staff: "الموظفين",
  students: "الأطفال",
  classes: "الفصول",
  units: "الوحدات التعليمية",
  schedule: "الجدولة",
  attendance: "الحضور",
  finance: "الاشتراكات والفواتير",
  settings: "الإعدادات",
};

/**
 * The tree from the plan, plus two additions that the product needs and the
 * original list did not name:
 *
 * - `finance.*` — "الاشتراكات" alone cannot express an accountant who may issue
 *   invoices and read reports but must not touch children's files.
 * - `students.view` — the tree jumps straight to "إدارة". A teacher who can open
 *   a child's profile but not edit it has no key otherwise, and that is the most
 *   common staff permission in the product.
 */
export const PERMISSIONS: PermissionDefinition[] = [
  { key: "auth.portal", category: "auth", labelAr: "الدخول إلى البوابة" },
  { key: "auth.app", category: "auth", labelAr: "الدخول إلى التطبيق" },

  { key: "staff.view", category: "staff", labelAr: "عرض الموظفين" },
  { key: "staff.manage", category: "staff", labelAr: "إدارة الموظفين", hintAr: "إضافة وتعديل" },
  { key: "staff.archive", category: "staff", labelAr: "أرشفة الموظفين" },
  { key: "staff.delete", category: "staff", labelAr: "حذف الموظفين" },

  { key: "students.view", category: "students", labelAr: "عرض الأطفال" },
  { key: "students.manage", category: "students", labelAr: "إدارة الأطفال", hintAr: "إضافة وتعديل" },
  { key: "students.archive", category: "students", labelAr: "أرشفة الأطفال" },
  { key: "students.delete", category: "students", labelAr: "حذف الأطفال" },
  { key: "students.guardians", category: "students", labelAr: "صفحة أولياء الأمور" },
  { key: "students.files", category: "students", labelAr: "صفحة الملفات", hintAr: "التقييمات والمستندات" },

  { key: "classes.view", category: "classes", labelAr: "عرض الفصول" },
  { key: "classes.assign", category: "classes", labelAr: "تعيين الطفل لفصل" },
  { key: "classes.manage", category: "classes", labelAr: "إدارة الفصول" },
  { key: "classes.archive", category: "classes", labelAr: "أرشفة الفصول" },

  { key: "units.view", category: "units", labelAr: "عرض الوحدات" },
  { key: "units.manage", category: "units", labelAr: "إدارة الوحدات" },
  { key: "units.archive", category: "units", labelAr: "أرشفة الوحدات" },
  { key: "units.delete", category: "units", labelAr: "حذف الوحدات" },

  { key: "schedule.view", category: "schedule", labelAr: "عرض الجدولة" },
  { key: "schedule.manage", category: "schedule", labelAr: "إدارة الجدولة" },
  { key: "schedule.delete", category: "schedule", labelAr: "حذف الجدولة" },

  { key: "attendance.students", category: "attendance", labelAr: "حضور الأطفال" },
  { key: "attendance.staff", category: "attendance", labelAr: "حضور الطاقم" },

  { key: "finance.view", category: "finance", labelAr: "عرض التقارير المالية" },
  { key: "finance.manage", category: "finance", labelAr: "إصدار الفواتير والمصاريف" },
  { key: "finance.subscriptions", category: "finance", labelAr: "الاشتراكات" },

  { key: "settings.manage", category: "settings", labelAr: "إعدادات الحضانة" },
  { key: "settings.storage", category: "settings", labelAr: "مساحة التخزين" },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const PERMISSION_KEY_SET = new Set(PERMISSION_KEYS);

export function isPermissionKey(value: string): boolean {
  return PERMISSION_KEY_SET.has(value);
}

/** Drops anything not in the catalogue — an unknown key grants nothing anyway. */
export function sanitizePermissions(keys: string[]): string[] {
  return Array.from(new Set(keys.filter(isPermissionKey)));
}

export function permissionsByCategory(): Record<PermissionCategory, PermissionDefinition[]> {
  const grouped = {} as Record<PermissionCategory, PermissionDefinition[]>;
  for (const category of PERMISSION_CATEGORIES) grouped[category] = [];
  for (const permission of PERMISSIONS) grouped[permission.category].push(permission);
  return grouped;
}

/**
 * Sentinel held by the school owner's role.
 *
 * A wildcard rather than "every key in the catalogue": a role frozen as an
 * explicit list at seed time would not gain permissions added in later releases,
 * so the owner of an existing school would quietly lose access to each new
 * feature until someone re-ticked a box.
 */
export const ALL_PERMISSIONS = "*";

export interface RoleTemplate {
  key: string;
  nameAr: string;
  descriptionAr: string;
  permissions: string[];
}

const TEACHER_BASE = [
  "auth.portal",
  "auth.app",
  "students.view",
  "students.files",
  "classes.view",
  "classes.assign",
  "units.view",
  "schedule.view",
  "attendance.students",
];

/**
 * The six roles every school starts with.
 *
 * Seeded per school rather than shared globally, because a nursery will want to
 * adjust what its own teachers can see without changing it for every other
 * tenant. The template is the starting point, not a constraint.
 */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "manager",
    nameAr: "مدير",
    descriptionAr: "صلاحيات كاملة على الحضانة",
    permissions: [ALL_PERMISSIONS],
  },
  {
    key: "hr",
    nameAr: "موارد بشرية",
    descriptionAr: "إدارة الطاقم وحضوره",
    permissions: [
      "auth.portal",
      "auth.app",
      "staff.view",
      "staff.manage",
      "staff.archive",
      "attendance.staff",
      "schedule.view",
      "schedule.manage",
    ],
  },
  {
    key: "teacher",
    nameAr: "معلم/ة",
    descriptionAr: "أطفال فصلها وحضورهم",
    permissions: TEACHER_BASE,
  },
  {
    key: "special_ed",
    nameAr: "معلم/ة تربية خاصة",
    descriptionAr: "مثل المعلمة، مع تعديل ملفات الأطفال",
    // The distinguishing permission: special-needs staff maintain the child's
    // health and support notes, which an ordinary class teacher only reads.
    permissions: [...TEACHER_BASE, "students.manage"],
  },
  {
    key: "early_childhood",
    nameAr: "معلم/ة طفولة مبكرة",
    descriptionAr: "مثل المعلمة، مع الوحدات التعليمية",
    permissions: [...TEACHER_BASE, "units.manage", "schedule.manage"],
  },
  {
    key: "accountant",
    nameAr: "محاسب",
    descriptionAr: "الفواتير والاشتراكات والتقارير المالية",
    // Deliberately no `students.files` and no health data: an accountant needs
    // to know who is billable, not what a child is allergic to.
    permissions: [
      "auth.portal",
      "students.view",
      "finance.view",
      "finance.manage",
      "finance.subscriptions",
    ],
  },
];

/** Whether a permission list satisfies a required key, honouring the wildcard. */
export function grants(held: string[], required: string): boolean {
  return held.includes(ALL_PERMISSIONS) || held.includes(required);
}
