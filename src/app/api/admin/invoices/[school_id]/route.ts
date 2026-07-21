import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ school_id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { school_id } = await params;

  const invoices = await prisma.adminInvoice.findMany({
    where: { school_id },
    orderBy: { created_at: "desc" },
  });

  return Response.json(invoices);
}
