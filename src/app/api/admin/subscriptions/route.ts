import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const schools = await prisma.school.findMany({
    include: {
      subscription_plan: true,
      _count: { select: { students: { where: { isActive: true } } } },
    },
    orderBy: { renewal_date: "asc" },
  });

  const now = new Date();

  // MRR by month — last 12 months (simplified: use current active schools per month)
  const mrr: { month: string; revenue: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString("ar-SA", { month: "short", year: "numeric" });
    // Approximate: count schools created before month end that are still active
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    const activeSchools = schools.filter(
      (s) => s.createdAt <= monthEnd && s.subscription_status === "active" && s.subscription_plan
    );
    mrr.push({ month: label, revenue: activeSchools.reduce((sum, s) => sum + (s.subscription_plan?.price ?? 0), 0) });
  }

  return Response.json({
    schools: schools.map((s) => ({
      id: s.id,
      name: s.name,
      plan: s.subscription_plan,
      subscription_status: s.subscription_status,
      renewal_date: s.renewal_date,
      studentCount: s._count.students,
      daysUntilRenewal: s.renewal_date
        ? Math.ceil((s.renewal_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null,
    })),
    mrr,
  });
}
