import { z } from "zod";
import { logAction } from "@/lib/activity-logger";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";

const schema = z.object({
  status: z.enum(["PENDING", "PAID"]),
  expectedUpdatedAt: z.iso.datetime(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); }
  catch (error) { return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 }); }

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid expense status" }, { status: 422 });

  const { id } = await params;
  const now = new Date();
  const result = await prisma.expenseOccurrence.updateMany({
    where: {
      id,
      school_id: session.user.schoolId,
      updated_at: new Date(parsed.data.expectedUpdatedAt),
    },
    data: parsed.data.status === "PAID"
      ? { status: "PAID", paid_at: now, paid_by: session.user.name ?? session.user.id }
      : { status: "PENDING", paid_at: null, paid_by: null },
  });
  if (result.count !== 1) {
    const exists = await prisma.expenseOccurrence.findFirst({ where: { id, school_id: session.user.schoolId }, select: { id: true } });
    return Response.json(
      { error: exists ? "Expense changed in another session" : "Not found", code: exists ? "STALE_RECORD" : "NOT_FOUND" },
      { status: exists ? 409 : 404 }
    );
  }

  const updated = await prisma.expenseOccurrence.findFirstOrThrow({
    where: { id, school_id: session.user.schoolId },
    select: {
      id: true, due_date: true, amount: true, status: true, paid_at: true, updated_at: true,
      expense: { select: { id: true, title: true, type: true, is_active: true } },
    },
  });
  await logAction({
    school_id: session.user.schoolId,
    action: parsed.data.status === "PAID" ? "تحديد استحقاق مصروف كمدفوع" : "إعادة استحقاق مصروف إلى غير مدفوع",
    entity_type: "expense_occurrence",
    entity_id: id,
    entity_name: updated.expense.title,
    performed_by: session.user.name ?? "المدير",
    request,
  });
  return Response.json(updated);
}
