import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { generatePaymentCycles } from "@/lib/payment-cycles";
import {
  assertClassOwned,
  assertGuardianOwned,
  crossTenantResponse,
} from "@/lib/tenant-guard";
import { parseAcademicStage, parseAttendanceType, parsePaymentStatus } from "@/lib/enum-labels";
import { protectIdNumber } from "@/lib/pii-crypto";
import {
  STUDENT_STATUSES,
  buildStudentDeparture,
  getRetentionPolicy,
} from "@/lib/data-retention";
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
  /** Enrolment lifecycle. Sending anything but ACTIVE starts the retention clock. */
  status: z.enum(STUDENT_STATUSES as [string, ...string[]]).optional(),
  /** Departure date. Defaults to now when a leaving status arrives without one. */
  leftAt: z.string().nullish(),
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

  const parsed = updateStudentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const existing = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Anonymisation is a one-way door. Allowing edits afterwards would let a name
  // or a phone number be written back into a record the platform has already
  // certified as carrying no personal data — and the audit log would still claim
  // it was cleared.
  if (existing.anonymizedAt) {
    return Response.json(
      { error: "هذا السجل مجهَّل نهائياً ولا يمكن تعديله" },
      { status: 409 }
    );
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
  if ("academicStage" in data) updateData.academicStage = parseAcademicStage(data.academicStage);
  if ("period" in data) updateData.period = data.period ?? null;
  if ("idNumber" in data) {
    updateData.idNumber = data.idNumber ?? null;
    Object.assign(updateData, protectIdNumber(data.idNumber));
  }
  if ("dateOfBirth" in data) {
    updateData.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
  }
  if ("nationality" in data) updateData.nationality = data.nationality ?? null;
  if ("gender" in data) updateData.gender = data.gender ?? null;
  if ("allergies" in data) updateData.allergies = data.allergies ?? null;
  if ("attendanceType" in data)
    updateData.attendanceType = parseAttendanceType(data.attendanceType) ?? "REGULAR";
  if ("paymentMethod" in data) updateData.paymentMethod = data.paymentMethod ?? null;
  if ("enrollmentDate" in data) {
    updateData.enrollment_date = data.enrollmentDate ? new Date(data.enrollmentDate) : null;
  }
  if ("enrollmentEndDate" in data) {
    updateData.enrollmentEndDate = data.enrollmentEndDate
      ? new Date(data.enrollmentEndDate)
      : null;
  }
  if ("paymentStatus" in data)
    updateData.paymentStatus = parsePaymentStatus(data.paymentStatus) ?? "PENDING";
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.registration_fee !== undefined) updateData.registration_fee = data.registration_fee;

  // ---- Enrolment lifecycle -------------------------------------------------
  //
  // The retention clock can only start from a departure date, so classification
  // and date are applied together and never separately. An explicit `status`
  // wins; otherwise flipping `isActive` off is treated as a withdrawal, because
  // that is what the existing UI does when a child leaves and there would
  // otherwise be no date to count from at all.
  const departureStatus = data.status
    ? (data.status as (typeof STUDENT_STATUSES)[number])
    : data.isActive === false && existing.status === "ACTIVE"
      ? ("WITHDRAWN" as const)
      : data.isActive === true && existing.status !== "ACTIVE"
        ? ("ACTIVE" as const)
        : null;

  if (departureStatus) {
    const policy = await getRetentionPolicy();
    // An already-departed child keeps their original date unless the request
    // supplies a new one — re-saving the profile must not silently push the
    // expiry years into the future.
    const leftAt = data.leftAt
      ? new Date(data.leftAt)
      : (existing.leftAt ?? null);

    Object.assign(
      updateData,
      buildStudentDeparture(departureStatus, leftAt, policy.studentRetentionYears)
    );

    // An explicit `isActive` in the same request is the caller's intent and
    // outranks the value the helper derives.
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
  }

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

    /**
     * A match on phone or email is *another family's record* unless it is
     * already this child's guardian.
     *
     * The old branch overwrote whatever it found: typing a phone number that
     * happened to belong to a different guardian rewrote that guardian's name,
     * second contact and email with this child's data — corrupting a family that
     * was never part of the request, and silently re-parenting every sibling
     * attached to them.
     *
     * Linking is safe and is what the feature is for (siblings share a
     * guardian). Editing someone else's details is not.
     */
    const isOwnGuardian = foundGuardian?.id === existing.guardianId;

    if (foundGuardian && !isOwnGuardian) {
      // Link only. Their name and contacts stay exactly as they were.
      updateData.guardianId = foundGuardian.id;
    } else if (foundGuardian) {
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
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
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
