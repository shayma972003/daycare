import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateTeacherSchema = z.object({
  name: z.string().min(1).optional(),
  period: z.enum(["MORNING", "EVENING"]).nullish(),
  idNumber: z.string().nullish(),
  dateOfBirth: z.string().nullish(),
  nationality: z.string().nullish(),
  email: z.string().nullish(),
  phone1: z.string().nullish(),
  phone2: z.string().nullish(),
  paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]).nullish(),
  joinDate: z.string().nullish(),
  monthlySalary: z.number().nullish(),
  lateDeductionRate: z.number().nullish(),
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
    const teacher = await prisma.teacher.findFirst({
      where: { id, schoolId },
      include: { classes: true },
    });

    if (!teacher) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json(teacher, { status: 200 });
  } catch (error) {
    console.error("Teacher [id] GET error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
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
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  const existing = await prisma.teacher.findFirst({ where: { id, schoolId } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const teacher = await prisma.teacher.update({
    where: { id },
    data: updateData,
    include: { classes: true },
  });

  return Response.json(teacher, { status: 200 });
}

export async function DELETE(
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

  const existing = await prisma.teacher.findFirst({ where: { id, schoolId } });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.teacher.delete({ where: { id } });

  return Response.json({ success: true });
}
