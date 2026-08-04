"use client";

/**
 * Storage usage and reclamation (tasks 2.29–2.30).
 *
 * A stacked bar rather than a pie: the question is "how close am I to the
 * limit", which a bar against a known width answers at a glance and a pie cannot
 * answer at all.
 */

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { describeApiError } from "@/lib/api-error";
// From `storage-format`, not `storage-usage`: the latter opens a database
// connection at import time, which a Client Component must never do.
import { formatBytes } from "@/lib/storage-format";
import { formatAst } from "@/lib/datetime";
import { useT } from "@/lib/i18n-provider";

interface StorageResponse {
  studentFilesBytes: number;
  careReportBytes: number;
  staffFilesBytes: number;
  unitFilesBytes: number;
  invoiceBytes: number;
  otherBytes: number;
  totalBytes: number;
  usedBytes: number;
  quotaBytes: number | null;
  percentUsed: number | null;
  over: boolean;
  computedAt: string | null;
  labels: Record<string, string>;
}

const CATEGORY_KEYS = [
  "studentFilesBytes",
  "careReportBytes",
  "unitFilesBytes",
  "invoiceBytes",
  "staffFilesBytes",
  "otherBytes",
] as const;

const CATEGORY_COLORS: Record<(typeof CATEGORY_KEYS)[number], string> = {
  studentFilesBytes: "bg-[#2F96A6]",
  careReportBytes: "bg-[#F8B500]",
  unitFilesBytes: "bg-[#7C3AED]",
  invoiceBytes: "bg-[#2D7A4F]",
  staffFilesBytes: "bg-[#C45000]",
  otherBytes: "bg-gray-300",
};

export default function StoragePage() {
  const t = useT();
  const [data, setData] = useState<StorageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const load = useCallback(async (refresh = false) => {
    try {
      const response = await axios.get<StorageResponse>(
        `/api/storage${refresh ? "?refresh=1" : ""}`
      );
      setData(response.data);
      setError(null);
    } catch (err) {
      setError(describeApiError(err, t("storage.loadFailed")));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<StorageResponse>("/api/storage")
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch((err) => {
        if (!cancelled) setError(describeApiError(err, t("storage.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function refresh() {
    setBusy(true);
    setNotice(null);
    await load(true);
    setBusy(false);
  }

  async function purge() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await axios.post<{ cleared: number; freedBytes: number }>(
        "/api/storage",
        { action: "purge_invoice_pdfs" }
      );
      setNotice(
        t("storage.purged", {
          count: String(response.data.cleared),
          size: formatBytes(Math.max(0, response.data.freedBytes)),
        })
      );
      setConfirmPurge(false);
      await load();
    } catch (err) {
      setError(describeApiError(err, t("storage.purgeFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={t("storage.title")} />

      <div className="p-6 space-y-5">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
            {notice}
          </div>
        )}

        {!data ? (
          <p className="text-sm text-gray-400 py-10 text-center">{t("common.loading")}</p>
        ) : (
          <>
            <section className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <div>
                  <span className="text-2xl font-bold text-[#111111]">
                    {formatBytes(data.usedBytes)}
                  </span>
                  {data.quotaBytes !== null && (
                    <span className="text-sm text-gray-500">
                      {" "}{t("storage.ofQuota", { total: formatBytes(data.quotaBytes) })}
                    </span>
                  )}
                </div>
                {data.percentUsed !== null && (
                  <span
                    className={`text-sm font-medium ${
                      data.over ? "text-red-500" : data.percentUsed > 80 ? "text-amber-500" : "text-gray-500"
                    }`}
                  >
                    {data.percentUsed}%
                  </span>
                )}
              </div>

              {data.quotaBytes === null ? (
                <p className="text-sm text-gray-500">
                  {t("storage.noLimit")}
                </p>
              ) : (
                <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden flex">
                  {CATEGORY_KEYS.map((key) => {
                    const value = data[key];
                    if (value <= 0 || !data.quotaBytes) return null;
                    const width = Math.min(100, (value / data.quotaBytes) * 100);
                    return (
                      <span
                        key={key}
                        className={CATEGORY_COLORS[key]}
                        style={{ width: `${width}%` }}
                        title={`${data.labels[key]}: ${formatBytes(value)}`}
                      />
                    );
                  })}
                </div>
              )}

              {data.over && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {t("storage.overQuota")}
                </div>
              )}

              <p className="text-xs text-gray-400">
                {t("storage.lastComputedLabel")} {data.computedAt ? formatAst(new Date(data.computedAt), {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }) : "—"}
                {" · "}
                <button onClick={refresh} disabled={busy} className="text-[#2F96A6] hover:underline">
                  {t("common.recalculate")}
                </button>
              </p>
            </section>

            <section className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="font-bold text-[#111111] mb-4">{t("storage.breakdown")}</h2>
              <ul className="space-y-2">
                {CATEGORY_KEYS.map((key) => (
                  <li key={key} className="flex items-center gap-3 text-sm">
                    <span aria-hidden className={`w-3 h-3 rounded-sm ${CATEGORY_COLORS[key]}`} />
                    <span className="text-gray-700 flex-1">{data.labels[key]}</span>
                    <span className="text-gray-500">{formatBytes(data[key])}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="bg-white rounded-2xl shadow-sm p-6 space-y-3">
              <h2 className="font-bold text-[#111111]">{t("storage.purge")}</h2>
              <p className="text-sm text-gray-600">
                {t("storage.purgeHint")}
              </p>
              <p className="text-xs text-gray-400">
                {t("storage.protectedHint")}
              </p>

              {confirmPurge ? (
                <div className="flex gap-3">
                  <button
                    onClick={purge}
                    disabled={busy}
                    className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
                  >
                    {busy ? "..." : t("common.confirmDelete")}
                  </button>
                  <button
                    onClick={() => setConfirmPurge(false)}
                    className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmPurge(true)}
                  disabled={busy || data.invoiceBytes === 0}
                  className="px-5 py-2 border border-gray-300 text-gray-700 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {t("storage.purgeInvoiceFiles", { size: formatBytes(data.invoiceBytes) })}
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
