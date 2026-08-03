"use client";

/**
 * Retention and anonymisation control panel.
 *
 * Two jobs. It states the policy currently in force — the number the privacy
 * policy and the DPA promise — and it makes the queue visible: how many records
 * are archived, how many are past their date and still holding personal data,
 * how many have been cleared. A "waiting" count that keeps climbing is the only
 * on-screen symptom of a cron that has stopped running, which is why it is here
 * and not only in the logs.
 */

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { ANONYMIZED_ENTITY_LABELS } from "@/lib/enum-labels";
import { formatAst } from "@/lib/datetime";

interface EntityCounts {
  active: number;
  archived: number;
  pending: number;
  anonymized: number;
}

interface LogRow {
  id: string;
  entityType: keyof typeof ANONYMIZED_ENTITY_LABELS;
  anonymizedAt: string;
  executedBy: string;
  clearedFieldCount: number;
  retentionYears: number | null;
}

interface RetentionResponse {
  policy: {
    studentRetentionYears: number;
    employeeRetentionYears: number;
    anonymizationEnabled: boolean;
    lastSweepAt: string | null;
    lastSweepProcessed: number;
  };
  students: EntityCounts;
  teachers: EntityCounts;
  guardiansAnonymized: number;
  nextExpiryAt: string | null;
  nextRunAt: string;
  limits: { min: number; max: number };
  recent: LogRow[];
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

const DATETIME_FORMAT: Intl.DateTimeFormatOptions = {
  ...DATE_FORMAT,
  hour: "2-digit",
  minute: "2-digit",
};

function formatDate(value: string | null, options = DATE_FORMAT): string {
  if (!value) return "—";
  return formatAst(new Date(value), options);
}

export default function DataRetentionPage() {
  const [data, setData] = useState<RetentionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  // Draft copies so a half-typed number never reaches the server.
  const [studentYears, setStudentYears] = useState("");
  const [employeeYears, setEmployeeYears] = useState("");
  const [enabled, setEnabled] = useState(true);

  const apply = useCallback((payload: RetentionResponse) => {
    setData(payload);
    setStudentYears(String(payload.policy.studentRetentionYears));
    setEmployeeYears(String(payload.policy.employeeRetentionYears));
    setEnabled(payload.policy.anonymizationEnabled);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    try {
      apply((await axios.get<RetentionResponse>("/api/admin/data-retention")).data);
    } catch (err) {
      setError(describeApiError(err, "تعذر تحميل إعدادات الاحتفاظ"));
    }
  }, [apply]);

  // The fetch is started, not awaited, so no state is written during the effect
  // body. `cancelled` guards the late response of a page unmounted mid-request.
  useEffect(() => {
    let cancelled = false;
    axios
      .get<RetentionResponse>("/api/admin/data-retention")
      .then((response) => {
        if (!cancelled) apply(response.data);
      })
      .catch((err) => {
        if (!cancelled) setError(describeApiError(err, "تعذر تحميل إعدادات الاحتفاظ"));
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await axios.put<{ rescheduled: number }>("/api/admin/data-retention", {
        studentRetentionYears: Number(studentYears),
        employeeRetentionYears: Number(employeeYears),
        anonymizationEnabled: enabled,
      });
      // Changing the period re-dates every archived record, which is a much
      // bigger action than the form suggests — say so explicitly.
      setNotice(
        response.data.rescheduled > 0
          ? `تم الحفظ · أُعيد احتساب تاريخ الانتهاء لـ ${response.data.rescheduled} سجل`
          : "تم حفظ الإعدادات"
      );
      await load();
    } catch (err) {
      setError(describeApiError(err, "تعذر حفظ الإعدادات"));
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const response = await axios.post<{ students: number; teachers: number; guardians: number; failures: number; skipped: boolean }>(
        "/api/admin/data-retention/run",
        { confirm: "ANONYMIZE" }
      );
      const r = response.data;
      setNotice(
        r.skipped
          ? "التجهيل معطَّل حالياً — لم يُنفَّذ شيء"
          : `تم تجهيل ${r.students} طفل · ${r.teachers} موظف · ${r.guardians} ولي أمر${r.failures ? ` · ${r.failures} فشل` : ""}`
      );
      await load();
    } catch (err) {
      setError(describeApiError(err, "تعذر تنفيذ عملية التجهيل"));
    } finally {
      setRunning(false);
    }
  }

  if (!data) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-white mb-4">الاحتفاظ بالبيانات</h1>
        {error ? (
          <div role="alert" className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
            {error}
          </div>
        ) : (
          <div className="text-gray-400 text-sm">جارٍ التحميل…</div>
        )}
      </div>
    );
  }

  const totalPending = data.students.pending + data.teachers.pending;

  return (
    <div className="p-8 space-y-8" dir="rtl">
      <header>
        <h1 className="text-2xl font-bold text-white">الاحتفاظ بالبيانات والتجهيل</h1>
        <p className="text-gray-400 text-sm mt-1">
          تُحذف البيانات الشخصية بعد انتهاء مدة الاحتفاظ، وتبقى الإحصاءات والسجل المالي كاملة.
        </p>
      </header>

      {error && (
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {!data.policy.anonymizationEnabled && (
        <div role="alert" className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-sm text-amber-300">
          التجهيل التلقائي معطَّل — السجلات المنتهية مدتها تحتفظ ببياناتها الشخصية.
        </div>
      )}

      {/* Queue */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="أطفال مؤرشفون" value={data.students.archived} hint="غادروا وما زالت بياناتهم محفوظة" />
        <StatCard
          label="بانتظار التجهيل"
          value={totalPending}
          hint="انتهت مدة الاحتفاظ"
          tone={totalPending > 0 ? "warn" : "normal"}
        />
        <StatCard label="أطفال مجهَّلون" value={data.students.anonymized} hint="أُزيلت بياناتهم الشخصية" />
        <StatCard label="موظفون مجهَّلون" value={data.teachers.anonymized} hint={`أولياء أمور: ${data.guardiansAnonymized}`} />
      </section>

      {/* Schedule */}
      <section className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-6 space-y-3 max-w-xl">
        <h2 className="text-white font-semibold">الجدولة</h2>
        <InfoRow label="التنفيذ التالي" value={formatDate(data.nextRunAt, DATETIME_FORMAT)} />
        <InfoRow label="آخر تنفيذ" value={formatDate(data.policy.lastSweepAt, DATETIME_FORMAT)} />
        <InfoRow label="عدد السجلات في آخر تنفيذ" value={String(data.policy.lastSweepProcessed)} />
        <InfoRow label="أقرب سجل ينتهي" value={formatDate(data.nextExpiryAt)} />
        <button
          onClick={runNow}
          disabled={running}
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm rounded-xl"
        >
          {running ? "جارٍ التنفيذ…" : "تنفيذ الآن"}
        </button>
        <p className="text-gray-500 text-xs">
          يعالج السجلات المنتهية مدتها فقط، ولا يمكنه تجهيل سجل قبل موعده. العملية نهائية ولا يمكن التراجع عنها.
        </p>
      </section>

      {/* Policy */}
      <section className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-6 space-y-4 max-w-xl">
        <h2 className="text-white font-semibold">مدة الاحتفاظ</h2>
        <p className="text-gray-400 text-xs">
          تُحسب من تاريخ مغادرة الطفل أو الموظف. تغيير المدة يعيد احتساب تاريخ الانتهاء لكل السجلات المؤرشفة
          غير المجهَّلة.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <NumberField
            label="بيانات الأطفال (سنوات)"
            value={studentYears}
            onChange={setStudentYears}
            min={data.limits.min}
            max={data.limits.max}
          />
          <NumberField
            label="بيانات الموظفين (سنوات)"
            value={employeeYears}
            onChange={setEmployeeYears}
            min={data.limits.min}
            max={data.limits.max}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          تفعيل التجهيل التلقائي
        </label>

        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm rounded-xl"
        >
          {saving ? "جارٍ الحفظ…" : "حفظ"}
        </button>
      </section>

      {/* Audit trail */}
      <section>
        <h2 className="text-white font-semibold mb-4">آخر عمليات التجهيل</h2>
        <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-white/5">
                {["النوع", "التاريخ", "المنفِّذ", "حقول أُزيلت", "المدة"].map((h) => (
                  <th key={h} className="px-5 py-3 text-right text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.recent.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-gray-500">
                    لا توجد عمليات تجهيل بعد
                  </td>
                </tr>
              ) : (
                data.recent.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3 text-white">{ANONYMIZED_ENTITY_LABELS[row.entityType]}</td>
                    <td className="px-5 py-3 text-gray-300">{formatDate(row.anonymizedAt, DATETIME_FORMAT)}</td>
                    <td className="px-5 py-3 text-gray-400">{row.executedBy === "SYSTEM" ? "النظام" : row.executedBy}</td>
                    <td className="px-5 py-3 text-gray-300">{row.clearedFieldCount}</td>
                    <td className="px-5 py-3 text-gray-400">{row.retentionYears ? `${row.retentionYears} سنوات` : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "normal",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "normal" | "warn";
}) {
  return (
    <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-5">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${tone === "warn" ? "text-amber-400" : "text-white"}`}>
        {value}
      </div>
      {hint && <div className="text-gray-500 text-xs mt-1">{hint}</div>}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="text-gray-400 text-xs block mb-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-admin w-full"
      />
      <div className="text-gray-600 text-[11px] mt-1">{`بين ${min} و ${max}`}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
