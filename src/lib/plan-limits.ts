import { prisma } from "@/lib/prisma";

/**
 * Enforces the subscription plan's caps at creation time.
 *
 * `max_students` and `max_classes` were stored on every plan and surfaced on the
 * admin dashboard as an alert, but nothing ever stopped a school exceeding
 * them — the limits described the plan without constraining it. A school on a
 * 20-student trial could enrol two hundred.
 *
 * Counts only live records: soft-deleted and archived rows are not what the
 * school is paying to manage.
 */
export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

async function planFor(schoolId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { subscription_plan: { select: { name: true, max_students: true, max_classes: true } } },
  });
  return school?.subscription_plan ?? null;
}

/** Throws when adding `adding` more students would exceed the plan. */
export async function assertStudentCapacity(schoolId: string, adding = 1): Promise<void> {
  const plan = await planFor(schoolId);
  // No plan attached means no cap to enforce — the admin panel allows this.
  if (!plan || plan.max_students <= 0) return;

  const current = await prisma.student.count({
    where: { schoolId, deletedAt: null, isActive: true },
  });

  if (current + adding > plan.max_students) {
    throw new PlanLimitError(
      `خطة "${plan.name}" تسمح بـ${plan.max_students} طفلاً كحد أقصى (الحالي: ${current}). يرجى ترقية الخطة.`
    );
  }
}

export async function assertClassCapacity(schoolId: string, adding = 1): Promise<void> {
  const plan = await planFor(schoolId);
  if (!plan || plan.max_classes <= 0) return;

  const current = await prisma.class.count({ where: { schoolId, deletedAt: null } });

  if (current + adding > plan.max_classes) {
    throw new PlanLimitError(
      `خطة "${plan.name}" تسمح بـ${plan.max_classes} فصلاً كحد أقصى (الحالي: ${current}). يرجى ترقية الخطة.`
    );
  }
}

/** Turns a PlanLimitError into a 402, which says "upgrade" rather than "forbidden". */
export function planLimitResponse(error: unknown): Response | null {
  if (error instanceof PlanLimitError) {
    return Response.json({ error: error.message }, { status: 402 });
  }
  return null;
}
