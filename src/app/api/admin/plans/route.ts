import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const plans = await prisma.subscriptionPlan.findMany({ orderBy: { price: "asc" } });
  return Response.json(plans);
}

const createSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0),
  max_students: z.number().int().min(1),
  max_classes: z.number().int().min(1),
  max_whatsapp_per_month: z.number().int().min(0),
});

export async function POST(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });

  const plan = await prisma.subscriptionPlan.create({ data: parsed.data });

  await prisma.adminActivityLog.create({
    data: { action: "plan_created", metadata: { name: plan.name, price: plan.price }, performed_by: "super_admin" },
  });

  return Response.json(plan, { status: 201 });
}
