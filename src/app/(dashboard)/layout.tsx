import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { SessionProvider } from "@/components/layout/SessionProvider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return (
    <SessionProvider>
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 mr-60 min-h-screen">{children}</main>
      </div>
    </SessionProvider>
  );
}
