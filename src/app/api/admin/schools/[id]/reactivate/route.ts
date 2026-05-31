import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const school = await prisma.school.update({
    where: { id },
    data: {
      subscription_status: "active",
      suspended_at: null,
      suspension_reason: null,
    },
  });

  await prisma.adminActivityLog.create({
    data: { school_id: id, action: "school_reactivated", performed_by: "admin" },
  });

  return Response.json(school);
}
