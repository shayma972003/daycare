import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ reason: z.string().min(1) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "سبب الإيقاف مطلوب" }, { status: 400 });

  const school = await prisma.$transaction(async (tx) => {
    const [users, guardians] = await Promise.all([
      tx.user.findMany({ where: { schoolId: id }, select: { id: true } }),
      tx.guardianAccount.findMany({ where: { schoolId: id }, select: { id: true } }),
    ]);
    const updated = await tx.school.update({
      where: { id },
      data: {
        subscription_status: "suspended",
        suspended_at: new Date(),
        suspension_reason: parsed.data.reason,
      },
    });
    await tx.refreshToken.updateMany({
      where: {
        revokedAt: null,
        OR: [
          { userId: { in: users.map((user) => user.id) } },
          { guardianAccountId: { in: guardians.map((guardian) => guardian.id) } },
        ],
      },
      data: { revokedAt: new Date() },
    });
    await tx.deviceToken.deleteMany({ where: { schoolId: id } });
    await tx.adminActivityLog.create({
      data: { school_id: id, action: "school_suspended", metadata: { reason: parsed.data.reason }, performed_by: "admin" },
    });
    return updated;
  });

  return Response.json(school);
}
