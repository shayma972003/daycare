"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import axios from "axios";

const NAV_ITEMS = [
  { href: "/admin", label: "الرئيسية", icon: "⊞" },
  { href: "/admin/schools", label: "المدارس", icon: "⌂" },
  { href: "/admin/subscriptions", label: "الاشتراكات", icon: "◈" },
  { href: "/admin/communications", label: "التواصل", icon: "✉" },
  { href: "/admin/logs", label: "السجل", icon: "≡" },
  { href: "/admin/data-retention", label: "الاحتفاظ بالبيانات", icon: "⏳" },
  { href: "/admin/settings", label: "الإعدادات", icon: "⚙" },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await axios.post("/api/admin/auth/logout");
    router.push("/admin/login");
  }

  return (
    <aside className="w-60 bg-[#1e1e2e] flex flex-col border-l border-white/5 shrink-0">
      {/* Brand */}
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-lg">
            ي
          </div>
          <div>
            <div className="text-white font-bold text-sm">لوحة الإدارة</div>
            <div className="text-gray-500 text-xs">النظام المركزي</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all ${
                isActive
                  ? "bg-indigo-600 text-white font-medium"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/5">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all w-full"
        >
          <span className="text-base w-5 text-center">⏻</span>
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}
