import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const schools = await prisma.school.findMany({
    include: {
      subscription_plan: { select: { id: true, name: true, price: true } },
      _count: { select: { students: { where: { isActive: true } }, teachers: { where: { isActive: true } }, classes: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(
    schools.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      plan: s.subscription_plan,
      subscription_status: s.subscription_status,
      renewal_date: s.renewal_date,
      last_login_at: s.last_login_at,
      createdAt: s.createdAt,
      studentCount: s._count.students,
      teacherCount: s._count.teachers,
      classCount: s._count.classes,
    }))
  );
}
