import { prisma } from "@/lib/prisma";

/** Auto-stops monthly expenses whose end_date has passed but are still marked active. */
export async function deactivateExpiredExpenses(school_id: string) {
  const now = new Date();
  const expired = await prisma.expense.findMany({
    where: { school_id, type: "monthly", is_active: true, end_date: { lt: now } },
    select: { id: true, end_date: true },
  });

  for (const exp of expired) {
    await prisma.expense.update({
      where: { id: exp.id },
      data: { is_active: false, stopped_at: exp.end_date },
    });
  }
}
