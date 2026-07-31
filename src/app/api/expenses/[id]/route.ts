import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  amount: z.number().min(0).optional(),
  type: z.enum(["one_time", "monthly"]).optional(),
  start_date: z.string().optional(),
  end_date: z.string().nullish(),
});

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

  const expense = await prisma.expense.findFirst({ where: { id, school_id: schoolId } });
  if (!expense) return Response.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  }

  const { title, description, amount, type, start_date, end_date } = parsed.data;

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description: description ?? null }),
      ...(amount !== undefined && { amount }),
      ...(type !== undefined && { type }),
      ...(start_date !== undefined && { start_date: new Date(start_date) }),
      ...(end_date !== undefined && { end_date: end_date ? new Date(end_date) : null }),
    },
  });

  return Response.json(updated);
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

  const expense = await prisma.expense.findFirst({ where: { id, school_id: schoolId } });
  if (!expense) return Response.json({ error: "Not found" }, { status: 404 });

  await prisma.expense.delete({ where: { id } });
  return Response.json({ success: true });
}
