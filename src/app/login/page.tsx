"use client";

import { useState, useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  /**
   * Derived, not stored.
   *
   * This message says only one thing — "your password was changed" — and the
   * only input is a query parameter. Copying that into state through an effect
   * was a second render for a value already known during the first, and the
   * effect could not remove the message when the parameter went away.
   */
  const success =
    searchParams.get("reset") === "1"
      ? "تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن."
      : "";
  const [loading, setLoading] = useState(false);

  // 2FA state
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [twoFaSessionId, setTwoFaSessionId] = useState("");
  const [maskedTarget, setMaskedTarget] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);


  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      if (result.error.startsWith("2FA_REQUIRED:")) {
        const parts = result.error.split(":");
        setTwoFaSessionId(parts[1]);
        setMaskedTarget(parts.slice(2).join(":"));
        setStep("otp");
        setResendCooldown(60);
      } else if (result.error === "2FA_DELIVERY_FAILED") {
        setError("تعذر إرسال رمز التحقق إلى بريدك. تواصل مع الدعم.");
      } else if (result.error === "ACCOUNT_LOCKED") {
        setError("تم قفل الحساب مؤقتاً بعد عدة محاولات فاشلة. حاول بعد 15 دقيقة.");
      } else if (result.error === "SUBSCRIPTION_SUSPENDED") {
        setError("تم تعليق اشتراك المنشأة. يرجى التواصل مع الدعم لإعادة التفعيل.");
      } else if (result.error === "SUBSCRIPTION_EXPIRED") {
        setError("انتهى اشتراك المنشأة. يرجى التجديد للمتابعة.");
      } else {
        setError("البريد الإلكتروني أو كلمة المرور غير صحيحة");
      }
    } else {
      router.push("/");
      router.refresh();
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpError("");
    setOtpLoading(true);

    try {
      const res = await fetch("/api/auth/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twoFaSessionId, otp_code: otpCode }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setOtpError(data.error || "رمز التحقق غير صحيح");
        setOtpLoading(false);
        return;
      }

      const result = await signIn("credentials", {
        twofa_bypass_token: data.bypassToken,
        redirect: false,
      });

      setOtpLoading(false);

      if (result?.error) {
        setOtpError("حدث خطأ أثناء تسجيل الدخول، الرجاء المحاولة مرة أخرى");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setOtpLoading(false);
      setOtpError("حدث خطأ، الرجاء المحاولة مرة أخرى");
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setOtpError("");
    try {
      const res = await fetch("/api/auth/resend-2fa-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twoFaSessionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setOtpError(data.error || "تعذر إعادة الإرسال");
        return;
      }
      setTwoFaSessionId(data.twoFaSessionId);
      setResendCooldown(60);
    } catch {
      setOtpError("تعذر إعادة الإرسال");
    }
  }

  if (step === "otp") {
    return (
      <div dir="rtl" className="min-h-screen bg-[#1a2340] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8 gap-3">
            <div className="w-16 h-16 bg-white/10 rounded-2xl border-2 border-white/20" />
            <h1 className="text-white text-xl font-bold tracking-wide">نظام إدارة الروضة</h1>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-lg font-bold text-[#1a2340] mb-2 text-center">تم إرسال رمز التحقق إلى</h2>
            <p className="text-sm text-gray-500 mb-6 text-center" dir="ltr">
              {maskedTarget}
            </p>

            <form onSubmit={handleVerifyOtp} className="space-y-4" noValidate>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  رمز التحقق
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  placeholder="------"
                  dir="ltr"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] focus:border-transparent text-center text-lg tracking-[0.5em] transition-all"
                />
              </div>

              {otpError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
                  {otpError}
                </div>
              )}

              <button
                type="submit"
                disabled={otpLoading || otpCode.length !== 6}
                className="w-full py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-md hover:shadow-lg mt-2"
              >
                {otpLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    جارٍ التحقق…
                  </span>
                ) : (
                  "تأكيد"
                )}
              </button>

              <div className="text-center mt-3">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown > 0}
                  className="text-sm text-gray-500 hover:text-[#1a2340] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resendCooldown > 0
                    ? `لم تستلم الرمز؟ إعادة الإرسال (${resendCooldown})`
                    : "لم تستلم الرمز؟ إعادة الإرسال"}
                </button>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setStep("credentials");
                    setOtpCode("");
                    setOtpError("");
                  }}
                  className="text-xs text-gray-400 hover:text-[#1a2340] transition-colors"
                >
                  الرجوع
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#1a2340] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-16 h-16 bg-white/10 rounded-2xl border-2 border-white/20" />
          <h1 className="text-white text-xl font-bold tracking-wide">نظام إدارة الروضة</h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-bold text-[#1a2340] mb-6 text-center">تسجيل الدخول</h2>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@school.com"
                dir="ltr"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] focus:border-transparent text-sm transition-all"
              />
            </div>

            {/* Password with show/hide */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                كلمة المرور
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] focus:border-transparent text-sm transition-all pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium transition-colors"
                >
                  {showPassword ? "إخفاء" : "إظهار"}
                </button>
              </div>
            </div>

            {success && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 text-center">
                {success}
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-md hover:shadow-lg mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  جارٍ الدخول…
                </span>
              ) : (
                "دخول"
              )}
            </button>

            <div className="text-center mt-3">
              <Link href="/forgot-password" className="text-sm text-gray-500 hover:text-[#1a2340] transition-colors">
                نسيت كلمة المرور؟
              </Link>
            </div>
          </form>

        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
