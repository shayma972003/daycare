"use client";

import AdminNotificationBell from "@/components/AdminNotificationBell";

interface TopbarProps {
  title: string;
}

export function Topbar({ title }: TopbarProps) {
  return (
    <header className="h-16 bg-white border-b border-brand-border flex items-center justify-between px-6 shadow-card sticky top-0 z-30">
      <h1 className="text-lg font-bold text-navy">{title}</h1>
      <AdminNotificationBell />
    </header>
  );
}
