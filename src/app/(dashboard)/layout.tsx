import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/layout/Sidebar";
import { SessionProvider } from "@/components/layout/SessionProvider";
import { AlertsProvider } from "@/components/layout/AlertsProvider";

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
        <div className="min-h-screen flex">
          <Sidebar schoolName={school?.name} schoolLogo={school?.logoUrl} />
          <main className="flex-1 mr-[220px] min-h-screen bg-brand-bg">{children}</main>
        </div>
      </AlertsProvider>
    </SessionProvider>
  );
}
