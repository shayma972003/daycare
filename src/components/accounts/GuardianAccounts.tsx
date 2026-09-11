"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { useT } from "@/lib/i18n-provider";

type AccountState = "none" | "invited" | "expired" | "active" | "disabled";

interface GuardianRow {
  guardianId: string;
  name: string;
  email: string | null;
  phone: string | null;
  children: { id: string; name: string }[];
  account: {
    id: string;
    email: string;
    status: AccountState;
    inviteExpiresAt?: string | null;
    lastLoginAt: string | null;
  } | null;
}

interface CreateInvitationResponse {
  id: string;
  email: string;
  phone: string | null;
  invitationSent: boolean;
  deliveryStatus: "sent" | "failed";
}

interface ResendInvitationResponse {
  sent: boolean;
  deliveryStatus: "sent" | "failed";
}

function errorKey(status: number | undefined): string {
  if (status === 409) return "guardianAccounts.errors.conflict";
  if (status === 422) return "guardianAccounts.errors.validation";
  if (status === 429) return "guardianAccounts.errors.rateLimited";
  return "guardianAccounts.errors.generic";
}

function GuardianAccountsContent() {
  const t = useT();
  const [rows, setRows] = useState<GuardianRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inFlightId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    axios
      .get<GuardianRow[]>("/api/guardian-accounts", { signal: controller.signal })
      .then((response) => {
        setRows(response.data);
        setError(null);
      })
      .catch((requestError) => {
        if (!axios.isCancel(requestError)) {
          setError(t("guardianAccounts.errors.load"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [t]);

  function markInvited(
    guardianId: string,
    created?: Pick<CreateInvitationResponse, "id" | "email">
  ) {
    setRows((current) =>
      current.map((row) => {
        if (row.guardianId !== guardianId) return row;
        return {
          ...row,
          account: row.account
            ? { ...row.account, status: "invited", inviteExpiresAt: null }
            : created
              ? {
                  id: created.id,
                  email: created.email,
                  status: "invited",
                  inviteExpiresAt: null,
                  lastLoginAt: null,
                }
              : null,
        };
      })
    );
  }

  async function sendInitialInvitation(row: GuardianRow) {
    if (row.account || inFlightId.current) return;
    inFlightId.current = row.guardianId;
    setBusyId(row.guardianId);
    setError(null);
    setNotice(null);
    try {
      const response = await axios.post<CreateInvitationResponse>(
        "/api/guardian-accounts",
        { guardianId: row.guardianId }
      );
      markInvited(row.guardianId, response.data);
      setNotice(
        response.status === 207 || !response.data.invitationSent
          ? t("guardianAccounts.notices.createdDeliveryFailed")
          : t("guardianAccounts.notices.createdAndSent", {
              email: response.data.email,
            })
      );
    } catch (requestError) {
      const status = axios.isAxiosError(requestError)
        ? requestError.response?.status
        : undefined;
      setError(t(errorKey(status)));
    } finally {
      inFlightId.current = null;
      setBusyId(null);
    }
  }

  async function resendInvitation(row: GuardianRow) {
    if (
      !row.account ||
      !["invited", "expired"].includes(row.account.status) ||
      inFlightId.current
    ) {
      return;
    }
    inFlightId.current = row.guardianId;
    setBusyId(row.guardianId);
    setError(null);
    setNotice(null);
    try {
      const response = await axios.post<ResendInvitationResponse>(
        `/api/guardian-accounts/${encodeURIComponent(row.account.id)}/invite`
      );
      markInvited(row.guardianId);
      setNotice(
        response.status === 207 || !response.data.sent
          ? t("guardianAccounts.notices.resentDeliveryFailed")
          : t("guardianAccounts.notices.resent")
      );
    } catch (requestError) {
      const status = axios.isAxiosError(requestError)
        ? requestError.response?.status
        : undefined;
      setError(t(errorKey(status)));
    } finally {
      inFlightId.current = null;
      setBusyId(null);
    }
  }

  const statusStyles: Record<AccountState, string> = {
    active: "text-emerald-600",
    invited: "text-amber-600",
    expired: "text-orange-600",
    disabled: "text-red-500",
    none: "text-gray-400",
  };

  return (
    <section
      aria-labelledby="guardian-accounts-title"
      className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5"
    >
      <h2 id="guardian-accounts-title" className="font-bold text-[#111111]">
        {t("guardianAccounts.title")}
      </h2>
      <p className="mb-4 mt-1 text-xs leading-relaxed text-gray-500">
        {t("guardianAccounts.description")}
      </p>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"
        >
          {notice}
        </div>
      )}

      {loading ? (
        <p role="status" className="py-4 text-sm text-gray-400">
          {t("guardianAccounts.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-gray-400">{t("guardianAccounts.empty")}</p>
      ) : (
        <div
          role="region"
          aria-labelledby="guardian-accounts-title"
          tabIndex={0}
          className="overflow-x-auto"
        >
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                {["name", "email", "children", "status", "actions"].map((header) => (
                  <th key={header} className="px-3 py-2 text-start font-medium">
                    {t(`guardianAccounts.columns.${header}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => {
                const status = row.account?.status ?? "none";
                const email = row.account?.email ?? row.email;
                const busy = busyId === row.guardianId;
                const canCreate = status === "none" && !row.account;
                const canResend = status === "invited" || status === "expired";

                return (
                  <tr key={row.guardianId}>
                    <td className="px-3 py-3 text-[#111111]">{row.name}</td>
                    <td className="px-3 py-3 text-gray-600" dir="ltr">
                      {email ?? (
                        <span className="text-gray-300">
                          {t("guardianAccounts.noEmail")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-600">
                      {row.children.map((child) => child.name).join(t("guardianAccounts.listSeparator")) || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span className={statusStyles[status]}>
                        {t(`guardianAccounts.states.${status}`)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {!email && canCreate ? (
                        <span className="text-xs text-gray-400">
                          {t("guardianAccounts.addEmailFirst")}
                        </span>
                      ) : canCreate ? (
                        <button
                          type="button"
                          onClick={() => sendInitialInvitation(row)}
                          disabled={busy}
                          aria-label={t("guardianAccounts.sendFor", { name: row.name })}
                          className="text-xs text-[#5B14D1] hover:underline disabled:opacity-50"
                        >
                          {busy
                            ? t("guardianAccounts.sending")
                            : t("guardianAccounts.send")}
                        </button>
                      ) : canResend ? (
                        <button
                          type="button"
                          onClick={() => resendInvitation(row)}
                          disabled={busy}
                          aria-label={t("guardianAccounts.resendFor", { name: row.name })}
                          className="text-xs text-[#5B14D1] hover:underline disabled:opacity-50"
                        >
                          {busy
                            ? t("guardianAccounts.sending")
                            : t("guardianAccounts.resend")}
                        </button>
                      ) : status === "active" ? (
                        <span className="text-xs leading-relaxed text-gray-500">
                          {t("guardianAccounts.activeRecoveryPrefix")} {" "}
                          <Link
                            href="/forgot-password?kind=guardian"
                            className="text-[#5B14D1] underline"
                          >
                            {t("guardianAccounts.forgotPassword")}
                          </Link>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function GuardianAccounts() {
  return (
    <PermissionGate permission="students.guardians">
      <GuardianAccountsContent />
    </PermissionGate>
  );
}
