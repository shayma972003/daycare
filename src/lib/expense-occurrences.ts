import { Prisma } from "@/generated/prisma/client";
import { astDateOnly, astParts } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

type ExpenseOccurrenceClient = typeof prisma | Prisma.TransactionClient;

function currentMonthDueDate(startDate: Date, today: Date): Date {
  const start = astParts(startDate);
  const current = astParts(today);
  const lastDay = new Date(Date.UTC(current.year, current.month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(current.year, current.month, Math.min(start.day, lastDay)));
}

/**
 * Creates only the occurrence that is due now. It never invents historical debt:
 * legacy Expense rows did not record whether old months were paid.
 */
export async function syncExpenseOccurrence(
  expenseId: string,
  client: ExpenseOccurrenceClient = prisma,
  at: Date = new Date()
): Promise<number> {
  const expense = await client.expense.findUnique({ where: { id: expenseId } });
  if (!expense) return 0;

  const today = astDateOnly(at);
  const start = astDateOnly(expense.start_date);
  let due: Date;

  if (expense.type === "one_time") {
    due = start;
  } else {
    if (!expense.is_active) return 0;
    due = currentMonthDueDate(expense.start_date, today);
  }

  if (due > today || due < start) return 0;
  if (expense.end_date && due > astDateOnly(expense.end_date)) return 0;
  if (expense.stopped_at && due > astDateOnly(expense.stopped_at)) return 0;

  const result = await client.expenseOccurrence.createMany({
    data: [{
      school_id: expense.school_id,
      expense_id: expense.id,
      due_date: due,
      amount: expense.amount,
    }],
    skipDuplicates: true,
  });
  return result.count;
}

/** Daily, bounded sync for the cron. One occurrence at most per template. */
export async function syncAllExpenseOccurrences(at: Date = new Date()): Promise<number> {
  const today = astDateOnly(at);
  const expenses = await prisma.expense.findMany({
    where: {
      OR: [
        { type: "one_time", start_date: { lte: today } },
        {
          type: "monthly",
          is_active: true,
          start_date: { lte: today },
          AND: [
            { OR: [{ end_date: null }, { end_date: { gte: today } }] },
            { OR: [{ stopped_at: null }, { stopped_at: { gte: today } }] },
          ],
        },
      ],
    },
    select: { id: true },
  });

  let created = 0;
  for (const expense of expenses) created += await syncExpenseOccurrence(expense.id, prisma, at);
  return created;
}
