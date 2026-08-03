import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";

const createTeacherSchema = z.object({
  name: z.string().min(1),
  period: z.enum(["MORNING", "EVENING"]).optional(),
  idNumber: z.string().optional(),
  dateOfBirth: z.string().optional(),
  nationality: z.string().optional(),
  email: z.string().optional(),
  phone1: z.string().optional(),
  phone2: z.string().optional(),
  paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]).optional(),
  joinDate: z.string().optional(),
  monthlySalary: z.number().optional(),
  lateDeductionRate: z.number().optional(),
  qualification1: z.string().optional(),
  qualification2: z.string().optional(),
  qualification3: z.string().optional(),
  enrollmentEndDate: z.string().optional(),
});

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");
  const period = searchParams.get("period");

  const where: Record<string, unknown> = { schoolId, deletedAt: null };

  if (search) {
    where.name = { contains: search, mode: "insensitive" };
  }
  if (period) {
    where.period = period;
  }

  try {
    const teachers = await prisma.teacher.findMany({
      where,
      select: {
        id: true,
        name: true,
        period: true,
        isActive: true,
        classes: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });
    return Response.json(teachers, { status: 200 });
  } catch (error) {
    console.error("Teachers API error:", error);
    return Response.json({ error: "حدث خطأ، يرجى المحاولة مجدداً" }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createTeacherSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const {
    name,
    period,
    idNumber,
    dateOfBirth,
    nationality,
    email,
    phone1,
    phone2,
    paymentMethod,
    joinDate,
    monthlySalary,
    lateDeductionRate,
    qualification1,
    qualification2,
    qualification3,
    enrollmentEndDate,
  } = parsed.data;

  const teacher = await prisma.teacher.create({
    data: {
      schoolId,
      name,
      ...(period !== undefined && { period }),
      ...(idNumber !== undefined && { idNumber }),
      ...(dateOfBirth !== undefined && { dateOfBirth: new Date(dateOfBirth) }),
      ...(nationality !== undefined && { nationality }),
      ...(email !== undefined && { email }),
      ...(phone1 !== undefined && { phone1 }),
      ...(phone2 !== undefined && { phone2 }),
      ...(paymentMethod !== undefined && { paymentMethod }),
      ...(joinDate !== undefined && { joinDate: new Date(joinDate) }),
      ...(monthlySalary !== undefined && { monthlySalary }),
      ...(lateDeductionRate !== undefined && { lateDeductionRate }),
      ...(qualification1 !== undefined && { qualification1 }),
      ...(qualification2 !== undefined && { qualification2 }),
      ...(qualification3 !== undefined && { qualification3 }),
      ...(enrollmentEndDate !== undefined && {
        enrollmentEndDate: new Date(enrollmentEndDate),
      }),
    },
    include: { classes: true },
  });

  await logAction({
    school_id: schoolId,
    action: `إضافة معلم جديد: ${teacher.name}`,
    entity_type: "teacher",
    entity_id: teacher.id,
    entity_name: teacher.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(teacher, { status: 201 });
}
