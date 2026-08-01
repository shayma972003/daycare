import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { generatePaymentCycles } from "@/lib/payment-cycles";
import {
  assertClassOwned,
  assertGuardianOwned,
  crossTenantResponse,
} from "@/lib/tenant-guard";
import { z } from "zod";

const updateStudentSchema = z.object({
  name: z.string().min(1).optional(),
  classId: z.string().nullish(),
  healthCondition: z.string().nullish(),
  academicStage: z.string().nullish(),
  period: z.enum(["MORNING", "EVENING"]).nullish(),
  idNumber: z.string().nullish(),
  dateOfBirth: z.string().nullish(),
  nationality: z.string().nullish(),
  gender: z.enum(["MALE", "FEMALE"]).nullish(),
  allergies: z.string().nullish(),
  attendanceType: z.string().nullish(),
  paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]).nullish(),
  enrollmentDate: z.string().nullish(),
  enrollmentEndDate: z.string().nullish(),
  paymentStatus: z.string().nullish(),
  isActive: z.boolean().optional(),
  registration_fee: z.number().min(0).optional(),
  // Guardian fields
  guardianId: z.string().nullish(),
  guardianName: z.string().nullish(),
  guardianPhone1: z.string().nullish(),
  guardianPhone2: z.string().nullish(),
  guardianEmail: z.string().nullish(),
  guardianName2: z.string().nullish(),
  guardianPhone3: z.string().nullish(),
  guardianPhone4: z.string().nullish(),
  guardianEmail2: z.string().nullish(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  try {
    const student = await prisma.student.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: { class: true, guardian: true },
    });

    if (!student) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Siblings: other students sharing the same guardian in this school
    const siblings = student.guardianId
      ? await prisma.student.findMany({
          where: {
            schoolId,
            guardianId: student.guardianId,
            id: { not: id },
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, name: true, avatarUrl: true },
        })
      : [];

    const rawRegistrationFee = (student as unknown as Record<string, unknown>).registration_fee as number ?? 0;
    const registrationFeeIsDefault = !(rawRegistrationFee > 0);
    let registrationFee = rawRegistrationFee;
    if (registrationFeeIsDefault) {
      const settings = await prisma.settings.findUnique({ where: { schoolId }, select: { monthlyStudentFee: true } });
      registrationFee = settings?.monthlyStudentFee ?? 0;
    }

    return Response.json(
      {
        ...student,
        registration_fee: registrationFee,
        registration_fee_is_default: registrationFeeIsDefault,
        enrollmentDate: student.enrollment_date,
        siblings,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/students/[id]] error:", err);
    return Response.json({ error: "Internal server error", detail: String(err) }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateStudentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const existing = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) updateData.name = data.name;
  if ("classId" in data) {
    // Verified against this school before writing: the id arrives from the
    // client and used to be trusted, which allowed pointing a student at
    // another tenant's class.
    try {
      updateData.classId = await assertClassOwned(data.classId, schoolId);
    } catch (error) {
      const denied = crossTenantResponse(error);
      if (denied) return denied;
      throw error;
    }
    if (updateData.classId) updateData.needsClassWarning = false;
  }
  if ("healthCondition" in data) updateData.healthCondition = data.healthCondition ?? null;
  if ("academicStage" in data) updateData.academicStage = data.academicStage ?? null;
  if ("period" in data) updateData.period = data.period ?? null;
  if ("idNumber" in data) updateData.idNumber = data.idNumber ?? null;
  if ("dateOfBirth" in data) {
    updateData.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
  }
  if ("nationality" in data) updateData.nationality = data.nationality ?? null;
  if ("gender" in data) updateData.gender = data.gender ?? null;
  if ("allergies" in data) updateData.allergies = data.allergies ?? null;
  if ("attendanceType" in data) updateData.attendanceType = data.attendanceType ?? "دوام منتظم";
  if ("paymentMethod" in data) updateData.paymentMethod = data.paymentMethod ?? null;
  if ("enrollmentDate" in data) {
    updateData.enrollment_date = data.enrollmentDate ? new Date(data.enrollmentDate) : null;
  }
  if ("enrollmentEndDate" in data) {
    updateData.enrollmentEndDate = data.enrollmentEndDate
      ? new Date(data.enrollmentEndDate)
      : null;
  }
  if ("paymentStatus" in data) updateData.paymentStatus = data.paymentStatus ?? null;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.registration_fee !== undefined) updateData.registration_fee = data.registration_fee;

  // Guardian update logic
  if ("guardianId" in data && data.guardianId) {
    // Client is linking an existing guardian — prove it is one of ours first.
    try {
      updateData.guardianId = await assertGuardianOwned(data.guardianId, schoolId);
    } catch (error) {
      const denied = crossTenantResponse(error);
      if (denied) return denied;
      throw error;
    }
  } else if (data.guardianName) {
    // Find or create guardian
    const phone1 = data.guardianPhone1 ?? undefined;
    const email = data.guardianEmail ?? undefined;

    const foundGuardian = await prisma.guardian.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        OR: [
          ...(phone1 ? [{ phone1 }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
    });

    const extraGuardianFields = {
      ...(data.guardianName2 !== undefined && { name_2: data.guardianName2 ?? null }),
      ...(data.guardianPhone3 !== undefined && { phone_3: data.guardianPhone3 ?? null }),
      ...(data.guardianPhone4 !== undefined && { phone_4: data.guardianPhone4 ?? null }),
      ...(data.guardianEmail2 !== undefined && { email_2: data.guardianEmail2 ?? null }),
    };

    if (foundGuardian) {
      updateData.guardianId = foundGuardian.id;
      await prisma.guardian.update({
        where: { id: foundGuardian.id },
        data: {
          name: data.guardianName,
          ...(phone1 !== undefined && { phone1 }),
          ...(data.guardianPhone2 !== undefined && { phone2: data.guardianPhone2 ?? null }),
          ...(email !== undefined && { email }),
          ...extraGuardianFields,
        },
      });
    } else if (existing.guardianId) {
      updateData.guardianId = existing.guardianId;
      await prisma.guardian.update({
        where: { id: existing.guardianId },
        data: {
          name: data.guardianName,
          ...(phone1 !== undefined && { phone1 }),
          ...(data.guardianPhone2 !== undefined && { phone2: data.guardianPhone2 ?? null }),
          ...(email !== undefined && { email }),
          ...extraGuardianFields,
        },
      });
    } else {
      const created = await prisma.guardian.create({
        data: {
          schoolId,
          name: data.guardianName,
          phone1: phone1 ?? null,
          phone2: data.guardianPhone2 ?? null,
          email: email ?? null,
          ...extraGuardianFields,
        },
      });
      updateData.guardianId = created.id;
    }
  }

  const student = await prisma.student.update({
    where: { id },
    data: updateData,
    include: { class: true, guardian: true },
  });

  if ("enrollmentDate" in data || "enrollmentEndDate" in data || data.registration_fee !== undefined) {
    await generatePaymentCycles(student.id);
  }

  await logAction({
    school_id: schoolId,
    action: "تم تعديل بيانات الطالب",
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(student, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const existing = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.student.update({ where: { id }, data: { deletedAt: new Date() } });

  await logAction({
    school_id: schoolId,
    action: `تم نقل الطالب "${existing.name}" إلى سلة المحذوفات`,
    entity_type: "student",
    entity_id: existing.id,
    entity_name: existing.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
