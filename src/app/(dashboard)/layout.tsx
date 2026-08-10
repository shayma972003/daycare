import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { SessionProvider } from "@/components/layout/SessionProvider";
import { AlertsProvider } from "@/components/layout/AlertsProvider";
import { CommandPalette } from "@/components/layout/CommandPalette";

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
    ? await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, logoUrl: true } })
    : null;

  return (
    <SessionProvider>
      <AlertsProvider>
        {/* Mounted once for the whole dashboard — the shortcut has to work from
            every screen, not from a bar someone has to find first. */}
        <CommandPalette />
        <DashboardShell schoolName={school?.name} schoolLogo={school?.logoUrl}>
          {children}
        </DashboardShell>
      </AlertsProvider>
    </SessionProvider>
  );
}
