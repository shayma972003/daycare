"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { useT } from "@/lib/i18n-provider";

type RecoveryKind = "staff" | "guardian";

export function ForgotPasswordForm({ kind }: { kind: RecoveryKind }) {
  const t = useT();
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const guardianMode = kind === "guardian";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = identifier.trim();
    if (!trimmed || loading) return;
    setError("");
    setLoading(true);
    try {
      await axios.post(
        "/api/auth/forgot-password",
        guardianMode
          ? { email: trimmed, kind: "guardian" }
          : { identifier: trimmed }
      );
      // Keep identifiers out of URLs/history. The reset form also carries the
      // account kind internally, without asking the user for another choice.
      sessionStorage.setItem("reset_identifier", trimmed);
      if (guardianMode) sessionStorage.setItem("reset_kind", "guardian");
      else sessionStorage.removeItem("reset_kind");
      setSent(true);
    } catch {
      // One generic message for missing and existing accounts. The UI must not
      // become an account-enumeration oracle even when the provider fails.
      setError(t("auth.genericErrorAlt"));
    } finally {
      setLoading(false);
    }
  }

  const title = guardianMode
    ? t("guardianRecovery.forgotTitle")
    : t("auth.forgotTitle");
  const hint = guardianMode
    ? t("guardianRecovery.forgotHint")
    : t("auth.forgotHint");
  const label = guardianMode ? t("auth.email") : t("auth.emailOrPhone");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1a2340] p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-2xl border-2 border-white/20 bg-white/10" />
          <h1 className="text-xl font-bold tracking-wide text-white">{t("auth.appName")}</h1>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                <span aria-hidden="true" className="text-2xl font-bold text-green-600">✓</span>
              </div>
              <h2 className="text-lg font-bold text-[#1a2340]">{t("auth.sent")}</h2>
              <p className="text-sm leading-relaxed text-gray-600">
                {t("auth.codeSentNotice")}
              </p>
              <Link
                href={guardianMode ? "/reset-password?kind=guardian" : "/reset-password"}
                className="mt-2 block w-full rounded-xl bg-[#22c55e] py-3 text-center text-sm font-bold text-white transition-all hover:bg-[#16a34a]"
              >
                {t("auth.enterCode")}
              </Link>
              {!guardianMode && (
                <Link href="/login" className="mt-2 block text-sm text-gray-500 hover:text-[#1a2340]">
                  {t("auth.backToSignIn")}
                </Link>
              )}
            </div>
          ) : (
            <>
              <h2 className="mb-2 text-center text-lg font-bold text-[#1a2340]">{title}</h2>
              <p className="mb-6 text-center text-sm text-gray-500">{hint}</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="recovery-identifier" className="mb-1.5 block text-sm font-medium text-gray-700">
                    {label}
                  </label>
                  <input
                    id="recovery-identifier"
                    type={guardianMode ? "email" : "text"}
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    required
                    placeholder={guardianMode ? "name@example.com" : t("auth.identifierHint")}
                    autoComplete="email"
                    dir="ltr"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
                  />
                </div>

                {error && (
                  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-[#22c55e] py-3 text-sm font-bold text-white transition-all hover:bg-[#16a34a] disabled:opacity-60"
                >
                  {loading ? t("auth.sending") : t("auth.sendCode")}
                </button>

                {!guardianMode && (
                  <Link href="/login" className="mt-2 block text-center text-sm text-gray-500 hover:text-[#1a2340]">
                    {t("auth.backToSignIn")}
                  </Link>
                )}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RoutedForgotPasswordForm() {
  const searchParams = useSearchParams();
  const kind: RecoveryKind = searchParams.get("kind") === "guardian" ? "guardian" : "staff";
  return <ForgotPasswordForm kind={kind} />;
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#1a2340]" />}>
      <RoutedForgotPasswordForm />
    </Suspense>
  );
}
