import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const plans = await prisma.subscriptionPlan.findMany({
    where: { is_active: true, billing_interval: { in: ["MONTHLY", "YEARLY"] } },
    orderBy: { price: "asc" },
  });
  return Response.json(plans);
}

export async function POST(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  return Response.json({ error: "الخطط ثابتة: شهري 299 ر.س أو سنوي 2990 ر.س" }, { status: 405, headers: { Allow: "GET" } });
}
