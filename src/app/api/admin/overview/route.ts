import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    totalActiveSchools,
    totalStudents,
    newSchoolsThisMonth,
    cancelledThisMonth,
    schools,
    recentLogs,
  ] = await Promise.all([
    prisma.school.count({ where: { subscription_status: "active" } }),
    prisma.student.count({ where: { isActive: true } }),
    prisma.school.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.school.count({
      where: {
        subscription_status: { in: ["expired", "suspended"] },
        suspended_at: { gte: monthStart },
      },
    }),
    prisma.school.findMany({
      include: { subscription_plan: true, _count: { select: { students: true } } },
    }),
    prisma.adminActivityLog.findMany({
      take: 20,
      orderBy: { performed_at: "desc" },
      include: { school: { select: { name: true } } },
    }),
  ]);

  // MRR
  const mrr = schools
    .filter((s) => s.subscription_status === "active" && s.subscription_plan)
    .reduce((sum, s) => sum + (s.subscription_plan?.price ?? 0), 0);

  // Alerts
  const alerts: { schoolId: string; schoolName: string; type: string; detail: string }[] = [];
  for (const s of schools) {
    if (s.last_login_at && s.last_login_at < sevenDaysAgo) {
      alerts.push({ schoolId: s.id, schoolName: s.name, type: "no_login", detail: "لم يسجل دخولاً منذ أكثر من 7 أيام" });
    }
    if (s.renewal_date && s.renewal_date <= sevenDaysAhead && s.renewal_date >= now) {
      alerts.push({ schoolId: s.id, schoolName: s.name, type: "renewal_soon", detail: `ينتهي الاشتراك ${s.renewal_date.toLocaleDateString("ar-SA")}` });
    }
    if (s.subscription_status === "expired") {
      alerts.push({ schoolId: s.id, schoolName: s.name, type: "expired", detail: "الاشتراك منتهٍ" });
    }
    if (s.subscription_plan && s._count.students > s.subscription_plan.max_students) {
      alerts.push({ schoolId: s.id, schoolName: s.name, type: "plan_limit", detail: `تجاوز الحد (${s._count.students}/${s.subscription_plan.max_students})` });
    }
  }

  return Response.json({
    stats: {
      totalActiveSchools,
      totalStudents,
      mrr,
      newSchoolsThisMonth,
      cancelledThisMonth,
    },
    alerts,
    recentLogs: recentLogs.map((l) => ({
      id: l.id,
      action: l.action,
      schoolName: l.school?.name ?? null,
      metadata: l.metadata,
      performedBy: l.performed_by,
      performedAt: l.performed_at,
    })),
  });
}
