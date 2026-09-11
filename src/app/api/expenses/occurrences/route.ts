import { ExpenseOccurrenceStatus } from "@/generated/prisma/enums";
import { astDateOnly } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";

export async function GET(request: Request) {
  let session;
  try { session = await requireSession(); }
  catch (error) { return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 }); }

  const { searchParams } = new URL(request.url);
  const requestedStatus = searchParams.get("status");
  const status = requestedStatus && Object.values(ExpenseOccurrenceStatus).includes(requestedStatus as ExpenseOccurrenceStatus)
    ? requestedStatus as ExpenseOccurrenceStatus
    : undefined;
  const dueOnly = searchParams.get("due") === "1";
  const parsedLimit = Number(searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
  const where = {
    school_id: session.user.schoolId,
    ...(status ? { status } : {}),
    ...(dueOnly ? { due_date: { lte: astDateOnly() } } : {}),
  };

  const [items, count] = await Promise.all([
    prisma.expenseOccurrence.findMany({
      where,
      orderBy: [{ due_date: "asc" }, { created_at: "asc" }],
      take: limit,
      select: {
        id: true,
        due_date: true,
        amount: true,
        status: true,
        paid_at: true,
        updated_at: true,
        expense: { select: { id: true, title: true, type: true, is_active: true } },
      },
    }),
    prisma.expenseOccurrence.count({ where }),
  ]);

  return Response.json({ items, count });
}
