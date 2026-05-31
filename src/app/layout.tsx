import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "نظام إدارة الروضة",
  description: "نظام متكامل لإدارة روضة الأطفال",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${tajawal.variable} font-[family-name:var(--font-tajawal)] min-h-screen bg-[#f4f6fb]`}>
        {children}
      </body>
    </html>
  );
}
