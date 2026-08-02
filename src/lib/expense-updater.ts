import { prisma } from "@/lib/prisma";
import { astDayStart } from "@/lib/datetime";

/**
 * Marks recurring expenses whose end date has passed as stopped.
 *
 * Compares against the start of the current AST business day, not raw `now`.
 * End dates are entered as calendar dates, so using the exact instant retired an
 * expense up to three hours before its last day was over.
 */
async function deactivate(where: { school_id?: string }): Promise<number> {
  const today = astDayStart();

  // One statement instead of a query-then-update loop. `stopped_at` is set from
  // the expense's own end date so the record reads truthfully.
  const { count } = await prisma.expense.updateMany({
    where: { ...where, type: "monthly", is_active: true, end_date: { lt: today } },
    data: { is_active: false },
  });

  if (count > 0) {
    await prisma.$executeRaw`
      UPDATE "Expense"
      SET "stopped_at" = "end_date"
      WHERE "is_active" = false AND "stopped_at" IS NULL AND "end_date" IS NOT NULL
    `;
  }

  return count;
}

/** Single tenant. Called from the expenses routes after a write. */
export async function deactivateExpiredExpenses(school_id: string): Promise<number> {
  return deactivate({ school_id });
}

/** Every tenant. Called from the nightly job — never from a request path. */
export async function deactivateAllExpiredExpenses(): Promise<number> {
  return deactivate({});
}
