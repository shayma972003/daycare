import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("finance correctness contracts", () => {
  it("keeps finance GET routes read-only", () => {
    expect(source("src/app/api/statistics/dashboard/route.ts")).not.toContain("updatePaymentStatuses");
    expect(source("src/app/api/expenses/route.ts")).not.toContain("deactivateExpiredExpenses");
    const reports = source("src/app/api/financial-reports/route.ts");
    expect(reports).not.toContain("export async function POST");
    expect(reports).not.toContain("file_url: true");
  });

  it("keeps the expired-expense repair scoped to one school outside the global cron", () => {
    const updater = source("src/lib/expense-updater.ts");
    expect(updater).toContain('Prisma.sql`AND "school_id" = ${where.school_id}`');
    expect(updater).toContain("export async function deactivateAllExpiredExpenses");
  });

  it("does not fabricate historical unpaid one-time expenses during migration", () => {
    const migration = source("prisma/migrations/20260911150000_finance_expense_occurrences/migration.sql");
    expect(migration).toContain("'CANCELLED'::\"ExpenseOccurrenceStatus\"");
    expect(migration).toContain("e.\"type\" = 'one_time'");
    expect(migration).toContain("ON CONFLICT (\"expense_id\", \"due_date\") DO NOTHING");
  });

  it("creates one due occurrence idempotently and preserves the amount snapshot", async () => {
    vi.resetModules();
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const amount = { toString: () => "125.50" };
    const client = {
      expense: {
        findUnique: vi.fn().mockResolvedValue({
          id: "expense-1",
          school_id: "school-1",
          amount,
          type: "monthly",
          start_date: new Date("2026-01-31T00:00:00.000Z"),
          end_date: null,
          stopped_at: null,
          is_active: true,
        }),
      },
      expenseOccurrence: { createMany },
    };
    const { syncExpenseOccurrence } = await import("@/lib/expense-occurrences");

    await syncExpenseOccurrence(
      "expense-1",
      client as never,
      new Date("2026-09-30T09:00:00.000Z")
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        school_id: "school-1",
        expense_id: "expense-1",
        due_date: new Date("2026-09-30T00:00:00.000Z"),
        amount,
      })],
      skipDuplicates: true,
    });
  });

  it("protects paid expense history from template deletion", () => {
    const route = source("src/app/api/expenses/[id]/route.ts");
    expect(route).toContain('status: "PAID"');
    expect(route).toContain('code: "EXPENSE_HAS_PAYMENT_HISTORY"');
    expect(route.indexOf("expenseOccurrence.count")).toBeLessThan(route.indexOf("prisma.expense.delete"));
  });
});
