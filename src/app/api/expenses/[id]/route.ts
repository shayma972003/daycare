import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { syncExpenseOccurrence } from "@/lib/expense-occurrences";
import { z } from "zod";

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  amount: z.number().finite().positive().optional(),
  type: z.enum(["one_time", "monthly"]).optional(),
  start_date: z.iso.date().optional(),
  end_date: z.iso.date().nullish(),
});

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
  const nextStart = start_date ? new Date(start_date) : expense.start_date;
  const nextEnd = end_date === undefined ? expense.end_date : end_date ? new Date(end_date) : null;
  if (nextEnd && nextEnd < nextStart) {
    return Response.json({ error: "End date must not be before start date" }, { status: 422 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.expense.update({
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
    await syncExpenseOccurrence(saved.id, tx);
    return saved;
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
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { id } = await params;

  const expense = await prisma.expense.findFirst({ where: { id, school_id: schoolId } });
  if (!expense) return Response.json({ error: "Not found" }, { status: 404 });

  const paidOccurrences = await prisma.expenseOccurrence.count({
    where: { expense_id: id, school_id: schoolId, status: "PAID" },
  });
  if (paidOccurrences > 0) {
    return Response.json(
      {
        error: "An expense with payment history cannot be deleted",
        code: "EXPENSE_HAS_PAYMENT_HISTORY",
      },
      { status: 409 }
    );
  }

  await prisma.expense.delete({ where: { id } });
  return Response.json({ success: true });
}
