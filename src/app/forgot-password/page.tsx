"use client";

import { useState } from "react";
import Link from "next/link";
import axios from "axios";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    setError("");
    setLoading(true);
    try {
      await axios.post("/api/auth/forgot-password", { identifier: identifier.trim() });
      setSent(true);
    } catch {
      setError("حدث خطأ، يرجى المحاولة مجدداً");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#1a2340] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-16 h-16 bg-white/10 rounded-2xl border-2 border-white/20" />
          <h1 className="text-white text-xl font-bold tracking-wide">نظام إدارة الروضة</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <span className="text-green-600 text-2xl font-bold">✓</span>
              </div>
              <h2 className="text-lg font-bold text-[#1a2340]">تم الإرسال</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                إذا كان الحساب موجوداً، سيصلك رمز التحقق عبر البريد الإلكتروني أو واتساب خلال دقائق.
              </p>
              <Link
                href="/reset-password"
                className="block w-full py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all text-center mt-2"
              >
                أدخل رمز التحقق
              </Link>
              <Link href="/login" className="block text-sm text-gray-500 hover:text-[#1a2340] mt-2">
                العودة لتسجيل الدخول
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-[#1a2340] mb-2 text-center">نسيت كلمة المرور؟</h2>
              <p className="text-sm text-gray-500 text-center mb-6">
                أدخل بريدك الإلكتروني أو رقم الجوال المسجل وسنرسل لك رمز التحقق
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    البريد الإلكتروني أو رقم الجوال
                  </label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    placeholder="admin@school.com أو 05xxxxxxxx"
                    dir="ltr"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm transition-all"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      جارٍ الإرسال…
                    </span>
                  ) : "إرسال رمز التحقق"}
                </button>

                <Link href="/login" className="block text-sm text-gray-500 hover:text-[#1a2340] text-center mt-2">
                  العودة لتسجيل الدخول
                </Link>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
