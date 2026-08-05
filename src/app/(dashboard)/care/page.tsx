"use client";

/**
 * The teacher's daily-care screen (tasks 2.3–2.4).
 *
 * Children first, then the type. That order is the whole design: a teacher
 * finishes lunch and reports on the six who ate, so the selection is what she
 * already has in mind and the type is the single tap that follows. Type-first
 * would mean re-picking children for every kind of report.
 */

import { useCallback, useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { CareReportModal } from "@/components/care/CareReportModal";
import { QuickCareSheet } from "@/components/care/QuickCareSheet";
import { CARE_REPORT_TYPES, CARE_TYPE_LABEL_KEYS, CARE_TYPE_COLORS } from "@/lib/care-reports";
import { Icon, CARE_TYPE_ICON_NAMES } from "@/components/ui/Icon";
import { formatAst } from "@/lib/datetime";
import type { CareReportType } from "@/generated/prisma/enums";
import { useT } from "@/lib/i18n-provider";

interface ClassItem {
  id: string;
  name: string;
}

interface StudentRow {
  id: string;
  name: string;
  avatarUrl?: string | null;
  classId?: string | null;
}

interface ReportRow {
  id: string;
  type: CareReportType;
  typeLabel: string;
  summary: string;
  occurredAt: string;
  reportedByName: string;
  note: string | null;
  student: { id: string; name: string };
}

export default function CarePage() {
  // Locale-aware translation — see src/lib/i18n.ts.
  const t = useT();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [classFilter, setClassFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeType, setActiveType] = useState<CareReportType | null>(null);
  /* The one-child path. Kept separate from `selected` so opening it does not
     disturb a bulk selection the teacher is part-way through building. */
  const [quickChild, setQuickChild] = useState<StudentRow | null>(null);
  const [quickType, setQuickType] = useState<CareReportType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().slice(0, 10);

  const loadReports = useCallback(async () => {
    try {
      const response = await axios.get<ReportRow[]>(`/api/care-reports?date=${today}`);
      setReports(response.data);
    } catch (err) {
      setError(describeApiError(err, t("care.loadTodayFailed")));
    }
  }, [today, t]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      axios.get<ClassItem[]>("/api/classes"),
      axios.get<{ students?: StudentRow[] } | StudentRow[]>("/api/students"),
      axios.get<ReportRow[]>(`/api/care-reports?date=${today}`),
    ])
      .then(([classesRes, studentsRes, reportsRes]) => {
        if (cancelled) return;
        setClasses(classesRes.data);
        // The students route has returned both shapes over time; tolerate both
        // rather than break the screen on a response-shape change elsewhere.
        const list = Array.isArray(studentsRes.data)
          ? studentsRes.data
          : (studentsRes.data.students ?? []);
        setStudents(list);
        setReports(reportsRes.data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(describeApiError(err, t("common.loadFailed")));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [today, t]);

  const visible = classFilter
    ? students.filter((student) => student.classId === classFilter)
    : students;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(visible.map((student) => student.id)));
  }

  const selectedIds = [...selected];
  const selectedLabel =
    selectedIds.length === 1
      ? (students.find((s) => s.id === selectedIds[0])?.name ?? "")
      : t("care.selectedChildren", { n: String(selectedIds.length) });

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={t("care.title")} />

      <div className="p-6 space-y-6">
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

        {/* ── Children ──────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-bold text-[#111111]">{t("care.pickChildren")}</h2>
            <div className="flex items-center gap-2">
              <select
                value={classFilter}
                onChange={(e) => {
                  setClassFilter(e.target.value);
                  // Cleared on filter change: keeping a hidden child selected
                  // means filing a report against someone off-screen.
                  setSelected(new Set());
                }}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">{t("common.allClasses")}</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <button
                onClick={selectAllVisible}
                className="px-3 py-2 text-sm text-[#2F96A6] hover:underline"
              >
                {t("common.selectAll")}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={() => setSelected(new Set())}
                  className="px-3 py-2 text-sm text-gray-500 hover:underline"
                >
                  {t("common.clearSelection")}
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-400 py-6 text-center">{t("common.loadingDots")}</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">{t("care.noChildren")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {visible.map((student) => {
                const isSelected = selected.has(student.id);
                return (
                  /* Two targets in one card: the body toggles the bulk
                     selection, the ⚡ records for this child alone. */
                  <div
                    key={student.id}
                    className={`flex items-center rounded-xl text-sm transition-colors border overflow-hidden ${
                      isSelected
                        ? "bg-[#E0F7FA] border-[#2F96A6]"
                        : "bg-white border-gray-100 hover:bg-gray-50"
                    }`}
                  >
                    <button
                      onClick={() => toggle(student.id)}
                      aria-pressed={isSelected}
                      className="flex items-center gap-2 px-3 py-3 flex-1 min-w-0 text-right"
                    >
                      <span
                        aria-hidden
                        className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-xs ${
                          isSelected ? "bg-[#2F96A6] text-white" : "bg-gray-100 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className={`truncate ${isSelected ? "text-[#111111]" : "text-gray-700"}`}>
                        {student.name}
                      </span>
                    </button>
                    <button
                      onClick={() => setQuickChild(student)}
                      aria-label={t("care.quickFor", { name: student.name })}
                      title={t("care.quickFor", { name: student.name })}
                      className="px-3 py-3 text-gray-300 hover:text-[#2F96A6] hover:bg-white/60 transition-colors shrink-0"
                    >
                      ⚡
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── The eight types ───────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="font-bold text-[#111111] mb-1">{t("care.reportType")}</h2>
          <p className="text-xs text-gray-500 mb-4">
            {selected.size === 0
              ? t("care.pickOneFirst")
              : t("care.willRecordFor", { label: selectedLabel })}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {CARE_REPORT_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setActiveType(type)}
                disabled={selected.size === 0}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-[#2F96A6] hover:bg-[#E0F7FA] transition-all disabled:opacity-40 disabled:hover:border-gray-100 disabled:hover:bg-white"
              >
                <Icon
                  name={CARE_TYPE_ICON_NAMES[type]}
                  size={30}
                  className={CARE_TYPE_COLORS[type]}
                />
                <span className="text-xs font-medium text-[#111111] text-center leading-tight">
                  {t(CARE_TYPE_LABEL_KEYS[type])}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Today's feed ──────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="font-bold text-[#111111] mb-4">{t("care.todayReports")}</h2>
          {reports.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">{t("care.noneYet")}</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {reports.map((report) => (
                <li key={report.id} className="py-3 flex items-start gap-3">
                  <Icon
                    name={CARE_TYPE_ICON_NAMES[report.type]}
                    size={20}
                    className={`shrink-0 mt-0.5 ${CARE_TYPE_COLORS[report.type]}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#111111]">
                      <span className="font-medium">{report.student.name}</span>
                      <span className="text-gray-400"> · </span>
                      <span className="text-gray-600">{report.summary}</span>
                    </p>
                    {report.note && (
                      <p className="text-xs text-gray-500 mt-0.5">{report.note}</p>
                    )}
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {formatAst(new Date(report.occurredAt), {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      {report.reportedByName}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Type picker for the one-child path. Closing it leaves the bulk
          selection exactly as it was. */}
      {quickChild && !quickType && (
        <QuickCareSheet
          childName={quickChild.name}
          onPick={(type) => setQuickType(type)}
          onClose={() => setQuickChild(null)}
        />
      )}

      {/* Both paths end in the same form — only the children differ. */}
      {(activeType || (quickChild && quickType)) && (
        <CareReportModal
          type={(quickType ?? activeType) as CareReportType}
          studentIds={quickChild ? [quickChild.id] : selectedIds}
          studentLabel={quickChild ? quickChild.name : selectedLabel}
          onClose={() => {
            setActiveType(null);
            setQuickType(null);
            setQuickChild(null);
          }}
          onSaved={(message) => {
            setActiveType(null);
            setQuickType(null);
            setQuickChild(null);
            setNotice(message);
            setError(null);
            // Selection kept on purpose: the next report is usually about the
            // same children — nap after lunch, mood after nap.
            loadReports();
          }}
        />
      )}
    </div>
  );
}
