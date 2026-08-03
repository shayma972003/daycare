"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { PasswordRules, meetsRequiredRules } from "@/components/ui/PasswordRules";
import { PASSWORD_MIN_MESSAGE } from "@/lib/password-policy";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Prefilled from the request step so the user does not retype it. sessionStorage
  // is client-only, so this has to happen after mount rather than during render.
  useEffect(() => {
    const saved = sessionStorage.getItem("reset_identifier");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setIdentifier(saved);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!identifier.trim()) {
      setError("أدخل البريد الإلكتروني أو رقم الجوال");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("كلمة المرور وتأكيدها غير متطابقتين");
      return;
    }
    // One source for the rule and its wording — see src/lib/password-policy.ts.
    if (!meetsRequiredRules(newPassword)) {
      setError(PASSWORD_MIN_MESSAGE);
      return;
    }

    setLoading(true);
    try {
      await axios.post("/api/auth/reset-password", {
        identifier: identifier.trim(),
        otp: otp.trim(),
        newPassword,
      });
      sessionStorage.removeItem("reset_identifier");
      router.push("/login?reset=1");
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.error ?? "حدث خطأ"
          : "حدث خطأ"
      );
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
          <h2 className="text-lg font-bold text-[#1a2340] mb-2 text-center">تعيين كلمة مرور جديدة</h2>
          <p className="text-sm text-gray-500 text-center mb-6">
            أدخل رمز التحقق المرسل إليك ثم اختر كلمة مرور جديدة
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
                placeholder="name@example.com"
                dir="ltr"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">رمز التحقق</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                maxLength={6}
                placeholder="000000"
                dir="ltr"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm text-center tracking-widest font-mono transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">كلمة المرور الجديدة</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm transition-all pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium"
                >
                  {showPassword ? "إخفاء" : "إظهار"}
                </button>
              </div>
              {/* Live rules, so the policy is visible while there is still time
                  to act on it rather than as an error after submit. */}
              <PasswordRules value={newPassword} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">تأكيد كلمة المرور</label>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="••••••••"
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
              disabled={loading || otp.length < 6}
              className="w-full py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  جارٍ التحديث…
                </span>
              ) : "تعيين كلمة المرور"}
            </button>

            <div className="flex justify-between text-sm text-gray-500 pt-1">
              <Link href="/forgot-password" className="hover:text-[#1a2340]">إعادة إرسال الرمز</Link>
              <Link href="/login" className="hover:text-[#1a2340]">تسجيل الدخول</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
