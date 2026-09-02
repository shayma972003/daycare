import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { activityLogData, logAction } from "@/lib/activity-logger";
import { generatePaymentCycles } from "@/lib/payment-cycles";
import {
  assertClassOwned,
  assertGuardianOwned,
  crossTenantResponse,
} from "@/lib/tenant-guard";
import { parseAcademicStage, parsePaymentStatus } from "@/lib/enum-labels";
import { resolveStageId, foreignStageResponse } from "@/lib/academic-stage";
import { protectIdNumber } from "@/lib/pii-crypto";
import { studentDetailDto, studentDetailSelect } from "@/lib/roster-dto";
import { withNoStore } from "@/lib/auth-response";
import { moneyNumber } from "@/lib/money";
import { logSafeError } from "@/lib/safe-logger";
import {
  STUDENT_STATUSES,
  buildStudentDeparture,
  getRetentionPolicy,
} from "@/lib/data-retention";
import { z } from "zod";
import { requestTimeZone } from "@/lib/device-date";
import { requireStudentCycleFee, StudentCycleFeeError, studentFeeSettingsSelect } from "@/lib/student-cycle-fee";

const updateStudentSchema = z.object({
  name: z.string().min(1).optional(),
  classId: z.string().nullish(),
  healthCondition: z.string().nullish(),
  /** DEPRECATED — still accepted so older clients keep working. */
  academicStage: z.string().nullish(),
  /** The school's own academic stage (task 2.44). */
  stageId: z.string().nullish(),
  period: z.enum(["MORNING", "EVENING"]).nullish(),
  idNumber: z.string().nullish(),
  dateOfBirth: z.string().nullish(),
  nationality: z.string().nullish(),
  gender: z.enum(["MALE", "FEMALE"]).nullish(),
  allergies: z.string().nullish(),
  billingCycle: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"]).nullish(),
  billingIntervalDays: z.number().int().positive().nullish(),
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
  let timeZone: string;
  try { timeZone = requestTimeZone(request); }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }

  try {
    const student = await prisma.student.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: studentDetailSelect,
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

    const registrationFee = student.registration_fee;

    const revealIdentity =
      new URL(request.url).searchParams.get("revealIdentity") === "true" &&
      session.can("students.manage");
    if (revealIdentity) {
      await prisma.activityLog.create({
        data: activityLogData({
          school_id: schoolId,
          action: "كشف رقم هوية طالب كامل",
          entity_type: "student_identity",
          entity_id: student.id,
          performed_by: session.user.name ?? "المدير",
          request,
        }),
      });
    }

    return withNoStore(
      Response.json(
        studentDetailDto(
          student as unknown as Record<string, unknown> & {
            idNumber: string | null;
            encryptedIdNumber: string | null;
          },
          {
            contact: session.can("students.guardians") || session.can("students.manage"),
            health: session.can("students.manage"),
            financial: session.can("finance.view") || session.can("finance.manage"),
            revealIdentity,
          },
          { registrationFee: moneyNumber(registrationFee), registrationFeeIsDefault: false, siblings }, timeZone
        ),
        { status: 200 }
      )
    );
  } catch (err) {
    logSafeError("student-detail", err);
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
  let timeZone: string;
  try { timeZone = requestTimeZone(request); }
  catch { return Response.json({ error: "Invalid time zone" }, { status: 422 }); }
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
  const financialFields = [
    "paymentMethod",
    "enrollmentDate",
    "enrollmentEndDate",
    "paymentStatus",
    "registration_fee",
  ] as const;
  if (
    financialFields.some((field) => field in data) &&
    !session.can("finance.manage")
  ) {
    return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
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
  if ("stageId" in data) {
    try {
      updateData.stageId = await resolveStageId(data.stageId, schoolId);
    } catch (error) {
      const foreignStage = foreignStageResponse(error);
      if (foreignStage) return foreignStage;
      throw error;
    }
  }
  if ("period" in data) updateData.period = data.period ?? null;
  if ("idNumber" in data) {
    Object.assign(updateData, protectIdNumber(data.idNumber));
  }
  if ("dateOfBirth" in data) {
    updateData.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
  }
  if ("nationality" in data) updateData.nationality = data.nationality ?? null;
  if ("gender" in data) updateData.gender = data.gender ?? null;
  if ("allergies" in data) updateData.allergies = data.allergies ?? null;
  if ("billingCycle" in data) updateData.billingCycle = data.billingCycle ?? "MONTHLY";
  if ("billingIntervalDays" in data) updateData.billingIntervalDays = data.billingIntervalDays ?? null;
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

  let guardianUpdate: { id: string; data: Record<string, string | null> } | null = null;
  let guardianCreate: { schoolId: string; name: string; phone1: string | null; phone2: string | null; email: string | null; name_2?: string | null; phone_3?: string | null; phone_4?: string | null; email_2?: string | null } | null = null;

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
    const guardianData: Record<string, string | null> = {};
    if (data.guardianName !== undefined) guardianData.name = data.guardianName ?? null;
    if (data.guardianPhone1 !== undefined) guardianData.phone1 = data.guardianPhone1 ?? null;
    if (data.guardianPhone2 !== undefined) guardianData.phone2 = data.guardianPhone2 ?? null;
    if (data.guardianEmail !== undefined) guardianData.email = data.guardianEmail ?? null;
    if (data.guardianName2 !== undefined) guardianData.name_2 = data.guardianName2 ?? null;
    if (data.guardianPhone3 !== undefined) guardianData.phone_3 = data.guardianPhone3 ?? null;
    if (data.guardianPhone4 !== undefined) guardianData.phone_4 = data.guardianPhone4 ?? null;
    if (data.guardianEmail2 !== undefined) guardianData.email_2 = data.guardianEmail2 ?? null;
    if (Object.keys(guardianData).length > 0) guardianUpdate = { id: data.guardianId, data: guardianData };
  } else if (data.guardianName !== undefined || data.guardianPhone1 !== undefined || data.guardianPhone2 !== undefined || data.guardianEmail !== undefined || data.guardianName2 !== undefined || data.guardianPhone3 !== undefined || data.guardianPhone4 !== undefined || data.guardianEmail2 !== undefined || existing.guardianId) {
    // Find or create guardian
    // Preserve an explicit null so clearing an optional contact is a real
    // partial update; an omitted field remains untouched.
    const phone1 = "guardianPhone1" in data ? (data.guardianPhone1 ?? null) : undefined;
    const email = "guardianEmail" in data ? (data.guardianEmail ?? null) : undefined;

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
      // A matching phone/email is not proof of the family's guardian.
      return Response.json({ error: "Guardian belongs to another family" }, { status: 409 });
    } else if (foundGuardian) {
      updateData.guardianId = foundGuardian.id;
      guardianUpdate = {
        id: foundGuardian.id,
        data: {
          ...(data.guardianName !== undefined && { name: data.guardianName ?? null }),
          ...(phone1 !== undefined && { phone1: phone1 ?? null }),
          ...(data.guardianPhone2 !== undefined && { phone2: data.guardianPhone2 ?? null }),
          ...(email !== undefined && { email: email ?? null }),
          ...extraGuardianFields,
        },
      };
    } else if (existing.guardianId) {
      updateData.guardianId = existing.guardianId;
      guardianUpdate = {
        id: existing.guardianId,
        data: {
          ...(data.guardianName !== undefined && { name: data.guardianName ?? null }),
          ...(phone1 !== undefined && { phone1: phone1 ?? null }),
          ...(data.guardianPhone2 !== undefined && { phone2: data.guardianPhone2 ?? null }),
          ...(email !== undefined && { email: email ?? null }),
          ...extraGuardianFields,
        },
      };
    } else {
      if (!data.guardianName?.trim()) {
        return Response.json({ error: "Guardian name is required" }, { status: 422 });
      }
      guardianCreate = {
        schoolId,
        name: data.guardianName,
        phone1: phone1 ?? null,
        phone2: data.guardianPhone2 ?? null,
        email: email ?? null,
        ...extraGuardianFields,
      };
    }
  }

  try {
  const student = await prisma.$transaction(async (tx) => {
    const nextCycle = "billingCycle" in data ? data.billingCycle ?? "MONTHLY" : existing.billingCycle;
    const billingCycleChanged = "billingCycle" in data && nextCycle !== existing.billingCycle;
    if (billingCycleChanged) {
      if (nextCycle === "CUSTOM") {
        if (existing.billingCycle !== "CUSTOM") throw new StudentCycleFeeError();
        updateData.cycleFee = existing.cycleFee;
      } else {
        const settings = await tx.settings.findUnique({ where: { schoolId }, select: studentFeeSettingsSelect });
        updateData.cycleFee = requireStudentCycleFee(nextCycle, settings);
        updateData.billingIntervalDays = null;
      }
    }
    if (guardianUpdate) {
      await tx.guardian.update({ where: { id: guardianUpdate.id }, data: guardianUpdate.data });
    }
    if (guardianCreate) {
      const created = await tx.guardian.create({ data: guardianCreate });
      updateData.guardianId = created.id;
    }
    const updated = await tx.student.update({ where: { id }, data: updateData, select: studentDetailSelect });
    if (
      "enrollmentDate" in data ||
      "enrollmentEndDate" in data ||
      data.registration_fee !== undefined ||
      billingCycleChanged ||
      "billingIntervalDays" in data
    ) {
      await generatePaymentCycles(updated.id, tx);
    }
    await tx.activityLog.create({ data: activityLogData({
      school_id: schoolId,
      action: "student profile updated",
      entity_type: "student",
      entity_id: updated.id,
      entity_name: updated.name,
      performed_by: session.user.name ?? "admin",
      request,
    }) });
    return updated;
  });

  return withNoStore(
    Response.json(
      studentDetailDto(
        student as unknown as Record<string, unknown> & {
          idNumber: string | null;
          encryptedIdNumber: string | null;
        },
        {
          contact: true,
          health: true,
          financial: session.can("finance.view") || session.can("finance.manage"),
          revealIdentity: false,
        },
        {
          registrationFee: moneyNumber(student.registration_fee),
          registrationFeeIsDefault: false,
          siblings: [],
        }, timeZone
      ),
      { status: 200 }
    )
  );
  } catch (error) {
    if (error instanceof StudentCycleFeeError) {
      return withNoStore(Response.json({ error: "Subscription fee is not configured", code: error.code }, { status: 422 }));
    }
    throw error;
  }
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
