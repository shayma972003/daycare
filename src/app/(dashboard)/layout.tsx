import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { SessionProvider } from "@/components/layout/SessionProvider";
import { DashboardSessionBoundary } from "@/components/layout/DashboardSessionBoundary";
import { AlertsProvider } from "@/components/layout/AlertsProvider";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { schoolSubscriptionAccess } from "@/lib/school-subscription";
import { headers } from "next/headers";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  const schoolId = (session.user as { schoolId?: string }).schoolId;
  const school = schoolId
    ? await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, logoUrl: true, subscription_status: true, renewal_date: true } })
    : null;
  if (!school) redirect("/login");
  const subscriptionAccess = schoolSubscriptionAccess(school);
  const pathname = (await headers()).get("x-pathname");
  if (subscriptionAccess.mode === "locked" && pathname && pathname !== "/subscription") {
    redirect("/subscription");
  }

  return (
    <SessionProvider session={session}>
      <DashboardSessionBoundary>
        <AlertsProvider disabled={subscriptionAccess.mode === "locked"}>
        {/* Mounted once for the whole dashboard — the shortcut has to work from
            every screen, not from a bar someone has to find first. */}
          {subscriptionAccess.mode !== "locked" && <CommandPalette />}
          <DashboardShell schoolName={school.name} schoolLogo={school.logoUrl} subscriptionAccess={subscriptionAccess}>
            {children}
          </DashboardShell>
        </AlertsProvider>
      </DashboardSessionBoundary>
    </SessionProvider>
  );
}
