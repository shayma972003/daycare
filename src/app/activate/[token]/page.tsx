"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { PasswordRules, meetsRequiredRules } from "@/components/ui/PasswordRules";
import { PASSWORD_MIN_MESSAGE } from "@/lib/password-policy";
import { useLocale } from "@/lib/i18n-provider";

interface Invite {
  kind: "school_admin" | "staff" | "guardian";
  name: string;
  email: string;
  schoolName: string;
}

export default function ActivatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const { t } = useLocale();

  const [invite, setInvite] = useState<Invite | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    axios
      .get<Invite>(`/api/activate/${encodeURIComponent(token)}`, {
        signal: controller.signal,
      })
      .then((response) => setInvite(response.data))
      .catch((requestError) => {
        if (!axios.isCancel(requestError)) setInvalid(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });

    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!done || invite?.kind !== "school_admin") return;
    const redirect = window.setTimeout(() => router.replace("/login"), 1500);
    return () => window.clearTimeout(redirect);
  }, [done, invite?.kind, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (password !== confirm) {
      setError(t("activation.passwordsDiffer"));
      return;
    }
    if (!meetsRequiredRules(password)) {
      setError(PASSWORD_MIN_MESSAGE);
      return;
    }

    setSaving(true);
    try {
      await axios.post(`/api/activate/${encodeURIComponent(token)}`, { password });
      setDone(true);
    } catch (requestError) {
      setError(
        axios.isAxiosError(requestError)
          ? requestError.response?.data?.error ?? t("activation.genericError")
          : t("activation.genericError")
      );
      setSaving(false);
    }
  }

  const invitationTitle =
    invite?.kind === "school_admin"
      ? t("activation.schoolAdminTitle")
      : invite?.kind === "guardian"
        ? t("activation.guardianTitle")
        : t("activation.staffTitle");

  const invitationBody =
    invite?.kind === "school_admin"
      ? t("activation.schoolAdminBody", { school: invite.schoolName })
      : invite?.kind === "guardian"
        ? t("activation.guardianBody", { school: invite.schoolName })
        : t("activation.staffBody", { school: invite?.schoolName ?? "" });

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#1a2340] p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-2xl border-2 border-white/20 bg-white/10" />
          <h1 className="text-xl font-bold tracking-wide text-white">
            {t("activation.productName")}
          </h1>
        </div>

        <section className="rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
          {checking ? (
            <p role="status" className="py-6 text-center text-sm text-gray-500">
              {t("activation.checking")}
            </p>
          ) : invalid ? (
            <div className="space-y-4 text-center">
              <h2 className="text-lg font-bold text-[#1a2340]">
                {t("activation.invalidTitle")}
              </h2>
              <p className="text-sm leading-relaxed text-gray-500">
                {t("activation.invalidBody")}
              </p>
              <Link href="/login" className="inline-block text-sm text-[#1a2340] underline">
                {t("activation.signIn")}
              </Link>
            </div>
          ) : done ? (
            <div className="space-y-4 text-center">
              <h2 className="text-lg font-bold text-[#1a2340]">
                {t("activation.successTitle")}
              </h2>
              <p className="text-sm leading-relaxed text-gray-500">
                {invite?.kind === "guardian"
                  ? t("activation.guardianSuccessBody")
                  : t("activation.successBody")}
              </p>
              {invite?.kind !== "guardian" && (
                <p role="status" className="text-xs text-gray-400">
                  {t("activation.redirecting")}
                </p>
              )}
              {invite?.kind !== "guardian" && (
                <Link
                  href="/login"
                  className="inline-block w-full rounded-xl bg-[#22c55e] py-3 text-sm font-bold text-white transition-all hover:bg-[#16a34a]"
                >
                  {t("activation.signIn")}
                </Link>
              )}
            </div>
          ) : (
            <>
              <p className="mb-2 text-center text-sm font-semibold text-[#16a34a]">
                {invitationTitle}
              </p>
              <h2 className="mb-2 text-center text-lg font-bold text-[#1a2340]">
                {t("activation.welcome", { name: invite?.name ?? "" })}
              </h2>
              <p className="mb-6 text-center text-sm leading-relaxed text-gray-500">
                {invitationBody}
              </p>

              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label htmlFor="activation-email" className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("activation.email")}
                  </label>
                  <input
                    id="activation-email"
                    type="email"
                    value={invite?.email ?? ""}
                    readOnly
                    dir="ltr"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500"
                  />
                </div>

                <div>
                  <label htmlFor="activation-password" className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("activation.password")}
                  </label>
                  <div className="relative">
                    <input
                      id="activation-password"
                      type={show ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      autoComplete="new-password"
                      dir="ltr"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 pe-12 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((current) => !current)}
                      className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-400 hover:text-gray-600"
                    >
                      {show ? t("activation.hide") : t("activation.show")}
                    </button>
                  </div>
                  <PasswordRules value={password} />
                </div>

                <div>
                  <label htmlFor="activation-confirm" className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("activation.confirmPassword")}
                  </label>
                  <input
                    id="activation-confirm"
                    type={show ? "text" : "password"}
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    required
                    autoComplete="new-password"
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
                  disabled={saving}
                  className="w-full rounded-xl bg-[#22c55e] py-3 text-sm font-bold text-white transition-all hover:bg-[#16a34a] disabled:opacity-60"
                >
                  {saving ? t("activation.saving") : t("activation.save")}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
