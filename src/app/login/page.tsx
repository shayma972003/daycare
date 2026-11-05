"use client";

import { useState, useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useLocale, useT } from "@/lib/i18n-provider";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";

function BrandAuthShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { locale } = useLocale();

  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-[#FBF9FF]">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(430px,0.85fr)]">
        <section className="brand-auth-background relative hidden min-h-screen overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
          <span aria-hidden className="absolute -start-24 -top-24 h-72 w-72 rounded-full border-[54px] border-white/10" />
          <span aria-hidden className="absolute -end-28 top-1/3 h-72 w-72 rounded-full bg-[#FF6B4A]/20" />
          <Image
            src="/brand/logo-orange-white.svg"
            alt={t("auth.appName")}
            width={230}
            height={59}
            priority
            className="relative z-10 h-auto w-[220px] self-center"
          />

          <div className="relative z-10 mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-10">
            <p className="mb-3 text-sm font-bold text-[#FFD4C9]">{t("auth.platformLabel")}</p>
            <h1 className="max-w-lg text-4xl font-bold leading-[1.35] xl:text-5xl">
              {t("auth.heroTitle")}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-8 text-white/75">
              {t("auth.heroDescription")}
            </p>
          </div>

          <div aria-hidden className="relative z-10 mx-auto flex h-44 w-full max-w-lg items-end justify-center gap-3">
            <Image src="/brand/square-excited.svg" alt="" width={125} height={125} className="h-24 w-24 -rotate-6 opacity-95 xl:h-28 xl:w-28" />
            <Image src="/brand/Hexagon-excited.svg" alt="" width={155} height={170} className="h-36 w-auto drop-shadow-[0_16px_22px_rgba(41,27,69,0.24)] xl:h-40" />
            <Image src="/brand/triangel-happy.svg" alt="" width={145} height={128} className="h-28 w-auto rotate-6 opacity-95 xl:h-32" />
          </div>
        </section>

        <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-24 sm:px-10 lg:px-12">
          <span aria-hidden className="absolute -start-20 -top-20 h-52 w-52 rounded-full bg-[#F1EBFD]" />
          <span aria-hidden className="absolute -end-20 bottom-8 h-48 w-48 rounded-full bg-[#FFF0EB]" />
          <div className="absolute end-4 top-4 z-20 w-44 rounded-xl border border-[#E7DEF8] bg-white/90 p-1 shadow-sm backdrop-blur sm:end-7 sm:top-6">
            <LanguageSwitcher />
          </div>
          <div className="relative z-10 w-full max-w-md">
            <div className="mb-8 flex justify-center lg:hidden">
              <Image src="/brand/logo-orange-purpule.svg" alt={t("auth.appName")} width={210} height={54} priority className="h-auto w-[190px]" />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function LoginForm() {
  const t = useT();
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
      ? t("auth.passwordChanged")
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

    if (result?.status === 503) {
      setError(t("auth.rateLimitUnavailable"));
    } else if (result?.error) {
      if (result.error.startsWith("2FA_REQUIRED:")) {
        const parts = result.error.split(":");
        setTwoFaSessionId(parts[1]);
        setMaskedTarget(parts.slice(2).join(":"));
        setStep("otp");
        setResendCooldown(60);
      } else if (result.error === "2FA_DELIVERY_FAILED") {
        setError(t("auth.otpSendFailed"));
      } else if (result.error === "ACCOUNT_LOCKED") {
        setError(t("auth.lockedOut"));
      } else if (result.error === "SUBSCRIPTION_SUSPENDED") {
        setError(t("auth.suspended"));
      } else if (result.error === "SUBSCRIPTION_EXPIRED") {
        setError(t("auth.expired"));
      } else {
        setError(t("auth.badCredentials"));
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
        setOtpError(data.error || t("auth.badOtp"));
        setOtpLoading(false);
        return;
      }

      const result = await signIn("credentials", {
        twofa_bypass_token: data.bypassToken,
        redirect: false,
      });

      setOtpLoading(false);

      if (result?.error) {
        setOtpError(t("auth.signInError"));
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setOtpLoading(false);
      setOtpError(t("settings.genericError"));
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
        setOtpError(data.error || t("auth.resendFailed"));
        return;
      }
      setTwoFaSessionId(data.twoFaSessionId);
      setResendCooldown(60);
    } catch {
      setOtpError(t("auth.resendFailed"));
    }
  }

  if (step === "otp") {
    return (
      <BrandAuthShell>
          <div className="rounded-[28px] border border-[#E7DEF8] bg-white p-7 shadow-[0_24px_70px_rgba(74,39,153,0.13)] sm:p-9">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F1EBFD] text-2xl font-bold text-[#4A2799]">#</div>
            <h2 className="mb-2 text-xl font-bold text-[#291B45]">{t("auth.codeSentTo")}</h2>
            <p className="text-sm text-gray-500 mb-6 text-center" dir="ltr">
              {maskedTarget}
            </p>

            <form onSubmit={handleVerifyOtp} className="space-y-4" noValidate>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t("auth.code")}
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
                  className="brand-focus-ring w-full rounded-xl border border-[#DED5EC] px-4 py-3 text-center text-lg tracking-[0.5em] transition-all"
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
                className="mt-2 w-full rounded-xl bg-[#6D3FD6] py-3 font-bold text-white shadow-[0_10px_24px_rgba(109,63,214,0.24)] transition-all hover:bg-[#4A2799] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {otpLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    {t("auth.verifying")}
                  </span>
                ) : (
                  t("common.confirm")
                )}
              </button>

              <div className="text-center mt-3">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown > 0}
                  className="text-sm text-gray-500 transition-colors hover:text-[#4A2799] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resendCooldown > 0
                    ? t("auth.resendIn", { n: String(resendCooldown) })
                    : t("auth.didNotGetIt")}
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
                  className="text-xs text-gray-400 transition-colors hover:text-[#4A2799]"
                >
                  {t("common.back")}
                </button>
              </div>
            </form>
          </div>
      </BrandAuthShell>
    );
  }

  return (
    <BrandAuthShell>
        <div className="rounded-[28px] border border-[#E7DEF8] bg-white p-7 shadow-[0_24px_70px_rgba(74,39,153,0.13)] sm:p-9">
          <div className="mb-7">
            <span className="mb-3 block h-1.5 w-10 rounded-full bg-[#FF6B4A]" />
            <h2 className="text-2xl font-bold text-[#291B45]">{t("auth.signInTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-[#81758E]">{t("auth.credentialHint")}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t("fields.email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@school.com"
                dir="ltr"
                className="brand-focus-ring w-full rounded-xl border border-[#DED5EC] bg-[#FCFBFE] px-4 py-3 text-sm transition-all"
              />
            </div>

            {/* Password with show/hide */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t("fields.password")}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  dir="ltr"
                  className="brand-focus-ring w-full rounded-xl border border-[#DED5EC] bg-[#FCFBFE] px-4 py-3 pe-12 text-sm transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-medium text-[#81758E] transition-colors hover:text-[#4A2799]"
                >
                  {showPassword ? t("fields.hide") : t("fields.show")}
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
              className="mt-2 w-full rounded-xl bg-[#6D3FD6] py-3 font-bold text-white shadow-[0_10px_24px_rgba(109,63,214,0.24)] transition-all hover:-translate-y-0.5 hover:bg-[#4A2799] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {t("auth.signingIn")}
                </span>
              ) : (
                t("auth.signIn")
              )}
            </button>

            <div className="text-center mt-3">
              <Link href="/forgot-password" className="text-sm text-gray-500 transition-colors hover:text-[#4A2799]">
                {t("auth.forgotTitle")}
              </Link>
            </div>
          </form>

        </div>
    </BrandAuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
