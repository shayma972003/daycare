import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const upsertExpenseSchema = z.object({
  rent: z.number().optional(),
  maintenance: z.number().optional(),
  materials: z.number().optional(),
  misc: z.number().optional(),
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
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
  const now = new Date();
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
  const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));

  const [expense, salariesResult] = await Promise.all([
    prisma.monthlyExpense.findUnique({
      where: { schoolId_month_year: { schoolId, month, year } },
    }),
    prisma.teacher.aggregate({
      where: { schoolId },
      _sum: { monthlySalary: true },
    }),
  ]);

  const salaries = salariesResult._sum.monthlySalary ?? 0;

  return Response.json({
    expense: expense ?? { schoolId, month, year, rent: 0, maintenance: 0, materials: 0, misc: 0 },
    salaries,
    month,
    year,
  }, { status: 200 });
}

export async function PUT(request: Request) {
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

  const parsed = upsertExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const now = new Date();
  const month = parsed.data.month ?? now.getMonth() + 1;
  const year = parsed.data.year ?? now.getFullYear();

  const data: Record<string, unknown> = {};
  if (parsed.data.rent !== undefined) data.rent = parsed.data.rent;
  if (parsed.data.maintenance !== undefined) data.maintenance = parsed.data.maintenance;
  if (parsed.data.materials !== undefined) data.materials = parsed.data.materials;
  if (parsed.data.misc !== undefined) data.misc = parsed.data.misc;

  const expense = await prisma.monthlyExpense.upsert({
    where: { schoolId_month_year: { schoolId, month, year } },
    create: { schoolId, month, year, ...data },
    update: data,
  });

  return Response.json(expense, { status: 200 });
}
