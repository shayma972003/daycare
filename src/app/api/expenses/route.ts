import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { syncExpenseOccurrence } from "@/lib/expense-occurrences";
import { logSafeError } from "@/lib/safe-logger";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  amount: z.number().finite().positive(),
  type: z.enum(["one_time", "monthly"]),
  start_date: z.iso.date(),
  end_date: z.iso.date().nullish(),
}).superRefine((value, ctx) => {
  if (value.end_date && value.end_date < value.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date must not be before start date" });
  }
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
  const typeFilter = searchParams.get("type"); // "one_time" | "monthly" | null

  const where: Record<string, unknown> = { school_id: schoolId };
  if (typeFilter) where.type = typeFilter;

  try {
    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { created_at: "desc" },
    });
    return Response.json(expenses);
  } catch (error) {
    logSafeError("expenses-list", error);
    return Response.json({ error: "Could not load expenses" }, { status: 500 });
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const firstErr = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return Response.json({ error: firstErr ?? "بيانات غير صحيحة" }, { status: 422 });
  }

  const { title, description, amount, type, start_date, end_date } = parsed.data;

  try {
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          school_id: schoolId,
          title,
          description: description ?? null,
          amount,
          type,
          start_date: new Date(start_date),
          end_date: end_date ? new Date(end_date) : null,
        },
      });
      await syncExpenseOccurrence(created.id, tx);
      return created;
    });
    return Response.json(expense, { status: 201 });
  } catch (error) {
    logSafeError("expenses-create", error);
    return Response.json({ error: "Could not create expense" }, { status: 500 });
  }
}
