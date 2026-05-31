import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  message_subject: z.string().min(1).optional(),
  message_template: z.string().min(1).optional(),
  threshold_days: z.number().int().nullish(),
  is_active: z.boolean().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });

  const rule = await prisma.automatedAlertRule.update({ where: { id }, data: parsed.data });
  return Response.json(rule);
}
