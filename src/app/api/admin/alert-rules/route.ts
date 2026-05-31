import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rules = await prisma.automatedAlertRule.findMany({ orderBy: { created_at: "asc" } });
  return Response.json(rules);
}
