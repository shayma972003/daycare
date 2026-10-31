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
import { getActiveSupportView } from "@/lib/support-view-session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supportView = await getActiveSupportView();
  const regularSession = supportView ? null : await getServerSession(authOptions);
  if (!regularSession && !supportView) {
    redirect("/login");
  }

  const session = regularSession ?? {
    user: {
      id: `support:${supportView!.id}`,
      name: "الدعم الفني",
      email: null,
      schoolId: supportView!.schoolId,
      schoolName: supportView!.schoolName,
      role: "support_read_only",
      authVersion: 0,
      supportAccessId: supportView!.id,
      supportAccessExpiresAt: supportView!.expiresAt.toISOString(),
    },
    expires: supportView!.expiresAt.toISOString(),
  };

  const schoolId = (session.user as { schoolId?: string }).schoolId;
  const school = schoolId
    ? await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, logoUrl: true, subscription_status: true, renewal_date: true } })
    : null;
  if (!school) redirect("/login");
  const subscriptionAccess = schoolSubscriptionAccess(school);
  const pathname = (await headers()).get("x-pathname");
  if (!supportView && subscriptionAccess.mode === "locked" && pathname && pathname !== "/subscription") {
    redirect("/subscription");
  }

  return (
    <SessionProvider session={session}>
      <DashboardSessionBoundary>
        <AlertsProvider disabled={subscriptionAccess.mode === "locked"}>
        {/* Mounted once for the whole dashboard — the shortcut has to work from
            every screen, not from a bar someone has to find first. */}
          {subscriptionAccess.mode !== "locked" && <CommandPalette />}
          <DashboardShell
            schoolName={school.name}
            schoolLogo={school.logoUrl}
            subscriptionAccess={subscriptionAccess}
            supportAccess={supportView ? { expiresAt: supportView.expiresAt.toISOString() } : null}
          >
            {children}
          </DashboardShell>
        </AlertsProvider>
      </DashboardSessionBoundary>
    </SessionProvider>
  );
}
