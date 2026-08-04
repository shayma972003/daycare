import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertClassOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { astParts, astDateOnly } from "@/lib/datetime";
import {
  EMPLOYMENT_STATUSES,
  buildTeacherDeparture,
  getRetentionPolicy,
} from "@/lib/data-retention";
import { z } from "zod";

const updateTeacherSchema = z.object({
  name: z.string().min(1).optional(),
  period: z.enum(["MORNING", "EVENING"]).nullish(),
  /** Primary class. The profile form sent this but the route never read it. */
  classId: z.string().nullish(),
  idNumber: z.string().nullish(),
  dateOfBirth: z.string().nullish(),
  nationality: z.string().nullish(),
  email: z.string().nullish(),
  phone1: z.string().nullish(),
  phone2: z.string().nullish(),
  paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]).nullish(),
  joinDate: z.string().nullish(),
  // Bounded like the create route: a negative salary is subtracted from the
  // month's wage bill, and nothing on screen explains the shortfall.
  monthlySalary: z.number().min(0).max(1_000_000).nullish(),
  lateDeductionRate: z.number().min(0).max(100).nullish(),
  qualification1: z.string().nullish(),
  qualification2: z.string().nullish(),
  qualification3: z.string().nullish(),
  qualification4: z.string().nullish(),
  qualification5: z.string().nullish(),
  qualification6: z.string().nullish(),
  qualification7: z.string().nullish(),
  qualification8: z.string().nullish(),
  qualification9: z.string().nullish(),
  qualification10: z.string().nullish(),
  enrollmentEndDate: z.string().nullish(),
  isActive: z.boolean().optional(),
  /** Post, qualification and field of study (task 2.39). */
  jobTitle: z.string().max(80).nullish(),
  educationLevel: z
    .enum(["HIGH_SCHOOL", "DIPLOMA", "BACHELOR", "MASTER", "PHD", "OTHER"])
    .nullish(),
  specialization: z.string().max(120).nullish(),
  /** Employment lifecycle. Anything but ACTIVE starts the retention clock. */
  status: z.enum(EMPLOYMENT_STATUSES as [string, ...string[]]).optional(),
  /** Last working day. Defaults to now when a leaving status arrives without one. */
  leftAt: z.string().nullish(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  try {
    const teacher = await prisma.teacher.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: { classes: true },
    });

    if (!teacher) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Month boundary in AST, not in server-local time. On Vercel the host runs
    // in UTC, so `new Date(y, m, 1)` named the wrong instant and, in the first
    // three hours of every month, counted the previous month's lateness.
    const now = new Date();
    const { year, month } = astParts(now);
    const lateCountThisMonth = await prisma.teacherAttendance.count({
      where: {
        teacherId: id,
        // Defence in depth: the teacher was already scoped, but attendance rows
        // carry their own `schoolId` and there is no reason not to use it.
        schoolId,
        lateMinutes: { gt: 0 },
        compensated: false,
        date: {
          gte: astDateOnly(new Date(Date.UTC(year, month, 1))),
          lte: now,
        },
      },
    });

    return Response.json({ ...teacher, lateCountThisMonth }, { status: 200 });
  } catch (error) {
    console.error("Teacher [id] GET error:", error);
    return Response.json({ error: "حدث خطأ، يرجى المحاولة مجدداً" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateTeacherSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) updateData.name = data.name;
  if ("period" in data) updateData.period = data.period ?? null;
  if ("idNumber" in data) updateData.idNumber = data.idNumber ?? null;
  if ("dateOfBirth" in data) {
    updateData.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
  }
  if ("nationality" in data) updateData.nationality = data.nationality ?? null;
  if ("email" in data) updateData.email = data.email ?? null;
  if ("phone1" in data) updateData.phone1 = data.phone1 ?? null;
  if ("phone2" in data) updateData.phone2 = data.phone2 ?? null;
  if ("paymentMethod" in data) updateData.paymentMethod = data.paymentMethod ?? null;
  if ("joinDate" in data) {
    updateData.joinDate = data.joinDate ? new Date(data.joinDate) : null;
  }
  if ("monthlySalary" in data) updateData.monthlySalary = data.monthlySalary ?? null;
  if ("lateDeductionRate" in data) updateData.lateDeductionRate = data.lateDeductionRate ?? null;
  for (const n of [1,2,3,4,5,6,7,8,9,10] as const) {
    const key = `qualification${n}` as keyof typeof data;
    if (key in data) updateData[key] = (data[key] as string | null | undefined) ?? null;
  }
  if ("enrollmentEndDate" in data) {
    updateData.enrollmentEndDate = data.enrollmentEndDate
      ? new Date(data.enrollmentEndDate)
      : null;
  }
  if ("jobTitle" in data) updateData.jobTitle = data.jobTitle?.trim() || null;
  if ("educationLevel" in data) updateData.educationLevel = data.educationLevel ?? null;
  if ("specialization" in data) {
    updateData.specialization = data.specialization?.trim() || null;
  }
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  const existing = await prisma.teacher.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Anonymisation is a one-way door — see the matching guard on the student
  // route for why an edit afterwards cannot be allowed.
  if (existing.anonymizedAt) {
    return Response.json(
      { error: "هذا السجل مجهَّل نهائياً ولا يمكن تعديله" },
      { status: 409 }
    );
  }

  // ---- Employment lifecycle -----------------------------------------------
  // Mirrors the student route: classification and departure date are written
  // together, because the retention clock has nothing to count from otherwise.
  const departureStatus = data.status
    ? (data.status as (typeof EMPLOYMENT_STATUSES)[number])
    : data.isActive === false && existing.status === "ACTIVE"
      ? ("RESIGNED" as const)
      : data.isActive === true && existing.status !== "ACTIVE"
        ? ("ACTIVE" as const)
        : null;

  if (departureStatus) {
    const policy = await getRetentionPolicy();
    const leftAt = data.leftAt ? new Date(data.leftAt) : (existing.leftAt ?? null);

    Object.assign(
      updateData,
      buildTeacherDeparture(departureStatus, leftAt, policy.employeeRetentionYears)
    );

    if (data.isActive !== undefined) updateData.isActive = data.isActive;
  }

  // Class assignment lives on Class.teacherId, not on Teacher, so it is applied
  // as a separate step: detach whatever this teacher currently owns, then
  // attach the chosen class. Both sides are verified against the school first.
  let classReassignment: { detachFrom: string; attachTo: string | null } | null = null;
  if ("classId" in data) {
    try {
      const ownedClassId = await assertClassOwned(data.classId, schoolId);
      classReassignment = { detachFrom: id, attachTo: ownedClassId };
    } catch (error) {
      const denied = crossTenantResponse(error);
      if (denied) return denied;
      throw error;
    }
  }

  const [teacher] = await prisma.$transaction([
    prisma.teacher.update({
      where: { id },
      data: updateData,
      include: { classes: true },
    }),
    ...(classReassignment
      ? [
          prisma.class.updateMany({
            where: { teacherId: classReassignment.detachFrom, schoolId },
            data: { teacherId: null, needsTeacherWarning: true },
          }),
          ...(classReassignment.attachTo
            ? [
                prisma.class.update({
                  where: { id: classReassignment.attachTo },
                  data: { teacherId: id, needsTeacherWarning: false },
                }),
              ]
            : []),
        ]
      : []),
  ]);

  await logAction({
    school_id: schoolId,
    action: "تم تعديل بيانات المعلم",
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(teacher, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  const existing = await prisma.teacher.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // `schoolId` on both secondary queries — see the matching note in the class
  // route for why the redundant filter is deliberate.
  const assignedClasses = await prisma.class.findMany({
    where: { teacherId: id, schoolId, deletedAt: null },
    select: { id: true, name: true, group: true },
  });

  await prisma.$transaction([
    prisma.teacher.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.class.updateMany({
      where: { teacherId: id, schoolId, deletedAt: null },
      data: { teacherId: null, needsTeacherWarning: true },
    }),
  ]);

  await logAction({
    school_id: schoolId,
    action: `تم نقل المعلم "${existing.name}" إلى سلة المحذوفات`,
    entity_type: "teacher",
    entity_id: existing.id,
    entity_name: existing.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, assignedClasses });
}
