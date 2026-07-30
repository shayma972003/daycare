import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { generatePaymentCycles } from "@/lib/payment-cycles";
import { updatePaymentStatuses } from "@/lib/payment-status-updater";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";

const createStudentSchema = z.object({
  name: z.string().min(1),
  classId: z.string().optional(),
  healthCondition: z.string().optional(),
  academicStage: z.string().optional(),
  period: z.enum(["MORNING", "EVENING"]).optional(),
  idNumber: z.string().optional(),
  dateOfBirth: z.string().optional(),
  nationality: z.string().optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  allergies: z.string().optional(),
  attendanceType: z.string().optional(),
  paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]).optional(),
  enrollmentDate: z.string().optional(),
  enrollmentEndDate: z.string().optional(),
  paymentStatus: z.string().optional(),
  // Guardian fields
  registration_fee: z.number().min(0).optional(),
  guardianId: z.string().optional(),
  guardianName: z.string().optional(),
  guardianPhone1: z.string().optional(),
  guardianPhone2: z.string().optional(),
  guardianEmail: z.string().optional(),
  guardianName2: z.string().optional(),
  guardianPhone3: z.string().optional(),
  guardianPhone4: z.string().optional(),
  guardianEmail2: z.string().optional(),
});

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  updatePaymentStatuses(schoolId).catch((err) => console.error("updatePaymentStatuses failed:", err));

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");
  const classId = searchParams.get("classId");
  const paymentStatus = searchParams.get("paymentStatus");
  const gender = searchParams.get("gender");

  const where: Record<string, unknown> = { schoolId, deletedAt: null };

  if (search) {
    where.name = { contains: search, mode: "insensitive" };
  }
  if (classId) {
    where.classId = classId;
  }
  if (paymentStatus) {
    where.paymentStatus = paymentStatus;
  }
  if (gender) {
    where.gender = gender;
  }

  const students = await prisma.student.findMany({
    where,
    select: {
      id: true,
      name: true,
      period: true,
      paymentStatus: true,
      classId: true,
      class: { select: { id: true, name: true } },
      guardian: { select: { id: true, name: true, phone1: true, phone2: true, email: true } },
      isActive: true,
      needsClassWarning: true,
      // avatarUrl / evaluationFileUrl are large base64 blobs (up to 100MB) — only
      // loaded on the individual student profile, never in this list query.
    },
    orderBy: { name: "asc" },
  });

  return Response.json(students, { status: 200 });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createStudentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const {
    name,
    classId,
    healthCondition,
    academicStage,
    period,
    idNumber,
    dateOfBirth,
    nationality,
    gender,
    allergies,
    attendanceType,
    paymentMethod,
    enrollmentDate,
    enrollmentEndDate,
    paymentStatus,
    guardianId: clientGuardianId,
    guardianName,
    guardianPhone1,
    guardianPhone2,
    guardianEmail,
    guardianName2,
    guardianPhone3,
    guardianPhone4,
    guardianEmail2,
    registration_fee,
  } = parsed.data;

  // Resolve guardian: link existing or create new
  let guardianId: string | undefined = clientGuardianId;

  if (!guardianId && guardianName) {
    // Try to find existing guardian by phone1 or email within school
    const existing = await prisma.guardian.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        OR: [
          ...(guardianPhone1 ? [{ phone1: guardianPhone1 }] : []),
          ...(guardianEmail ? [{ email: guardianEmail }] : []),
        ],
      },
    });

    if (existing) {
      guardianId = existing.id;
    } else {
      const created = await prisma.guardian.create({
        data: {
          schoolId,
          name: guardianName,
          phone1: guardianPhone1 ?? null,
          phone2: guardianPhone2 ?? null,
          email: guardianEmail ?? null,
          name_2: guardianName2 ?? null,
          phone_3: guardianPhone3 ?? null,
          phone_4: guardianPhone4 ?? null,
          email_2: guardianEmail2 ?? null,
        },
      });
      guardianId = created.id;
    }
  }

  const student = await prisma.student.create({
    data: {
      schoolId,
      name,
      ...(classId !== undefined && { classId }),
      ...(guardianId !== undefined && { guardianId }),
      ...(healthCondition !== undefined && { healthCondition }),
      ...(academicStage !== undefined && { academicStage }),
      ...(period !== undefined && { period }),
      ...(idNumber !== undefined && { idNumber }),
      ...(dateOfBirth !== undefined && { dateOfBirth: new Date(dateOfBirth) }),
      ...(nationality !== undefined && { nationality }),
      ...(gender !== undefined && { gender }),
      ...(allergies !== undefined && { allergies }),
      ...(attendanceType !== undefined && { attendanceType }),
      ...(paymentMethod !== undefined && { paymentMethod }),
      ...(enrollmentDate !== undefined && {
        enrollment_date: new Date(enrollmentDate),
      }),
      ...(enrollmentEndDate !== undefined && {
        enrollmentEndDate: new Date(enrollmentEndDate),
      }),
      ...(paymentStatus !== undefined && { paymentStatus }),
      ...(registration_fee !== undefined && { registration_fee }),
    },
    include: { class: true, guardian: true },
  });

  await generatePaymentCycles(student.id);

  await logAction({
    school_id: schoolId,
    action: `إضافة طالب جديد: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(student, { status: 201 });
}
