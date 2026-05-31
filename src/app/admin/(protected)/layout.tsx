import { redirect } from "next/navigation";
import { verifyAdminSession } from "@/lib/admin-auth";
import AdminSidebar from "@/components/admin/AdminSidebar";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await verifyAdminSession();
  if (!session) redirect("/admin/login");

  return (
    <div className="min-h-screen bg-[#0f0f1a] flex" dir="rtl">
      <AdminSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
