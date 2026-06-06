import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  amount: z.number().min(0),
  type: z.enum(["one_time", "monthly"]),
  start_date: z.string(),
});

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get("type"); // "one_time" | "monthly" | null

  const where: Record<string, unknown> = { school_id: schoolId };
  if (typeFilter) where.type = typeFilter;

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { created_at: "desc" },
  });

  return Response.json(expenses);
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  const { title, description, amount, type, start_date } = parsed.data;

  const expense = await prisma.expense.create({
    data: {
      school_id: schoolId,
      title,
      description: description ?? null,
      amount,
      type,
      start_date: new Date(start_date),
    },
  });

  return Response.json(expense, { status: 201 });
}
