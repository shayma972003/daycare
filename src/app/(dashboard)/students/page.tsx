"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { PaymentStatusBadge, PeriodBadge } from "@/components/ui/StatusBadge";
import { AvatarPlaceholder } from "@/components/ui/IconPlaceholder";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatTime } from "@/lib/utils";
import { PAYMENT_STATUSES } from "@/lib/payment-status";
import { describeApiError } from "@/lib/api-error";
import { useT, useLocale } from "@/lib/i18n-provider";

type Student = {
  id: string;
  name: string;
  period: "MORNING" | "EVENING";
  paymentStatus: "PAID" | "LATE" | "CANCELLED" | "SUSPENDED";
  class?: { id: string; name: string } | null;
  classId?: string | null;
  guardian?: { id: string; name: string; phone1?: string | null; phone2?: string | null; email?: string | null } | null;
  isActive: boolean;
  needsClassWarning?: boolean;
  avatarUrl?: string | null;
};

type Class = { id: string; name: string };

type EnrollmentSubmission = {
  id: string;
  full_name: string;
  guardian_name: string | null;
  guardian_phone_1: string | null;
  guardian_phone_2: string | null;
  guardian_email: string | null;
  guardian_name_2: string | null;
  guardian_phone_3: string | null;
  guardian_phone_4: string | null;
  guardian_email_2: string | null;
  id_number: string | null;
  nationality: string | null;
  academic_stage: string | null;
  gender: string | null;
  period: string | null;
  date_of_birth: string | null;
  health_condition: string | null;
  allergies: string | null;
  attendance_type: string | null;
  payment_method: string | null;
  submitted_at: string;
};

function LiveTimer({ from }: { from: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(from).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [from]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const fmt = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="font-mono text-sm font-semibold text-success-text tabular-nums">
      {fmt(h)}:{fmt(m)}:{fmt(s)}
    </span>
  );
}

export default function StudentsPage() {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [todayAtt, setTodayAtt] = useState<Record<string, { id: string; checkinAt: string | null; checkoutAt: string | null }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [bulkAction, setBulkAction] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [newEndDate, setNewEndDate] = useState("");
  const [isExtending, setIsExtending] = useState(false);
  const [xlsxUploading, setXlsxUploading] = useState(false);
  const [xlsxResult, setXlsxResult] = useState<{ added: number; failed: number; errors: string[] } | null>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Enrollment
  const [enrollmentModalOpen, setEnrollmentModalOpen] = useState(false);
  const [enrollEmail, setEnrollEmail] = useState("");
  const [enrollSending, setEnrollSending] = useState(false);
  const [enrollSuccess, setEnrollSuccess] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // Review queue
  const [submissions, setSubmissions] = useState<EnrollmentSubmission[]>([]);
  const [submissionsExpanded, setSubmissionsExpanded] = useState(false);
  const [reviewModalSub, setReviewModalSub] = useState<EnrollmentSubmission | null>(null);
  const [reviewClassId, setReviewClassId] = useState("");
  const [reviewApproving, setReviewApproving] = useState(false);
  const [reviewRejecting, setReviewRejecting] = useState(false);
  const [reviewEdit, setReviewEdit] = useState<Partial<EnrollmentSubmission & { date_of_birth_str: string }>>({});

  function openReviewModal(sub: EnrollmentSubmission) {
    setReviewModalSub(sub);
    setReviewClassId("");
    setReviewEdit({
      full_name: sub.full_name,
      id_number: sub.id_number ?? "",
      nationality: sub.nationality ?? "",
      academic_stage: sub.academic_stage ?? "",
      gender: sub.gender ?? "",
      period: sub.period ?? "",
      date_of_birth_str: sub.date_of_birth ? sub.date_of_birth.slice(0, 10) : "",
      health_condition: sub.health_condition ?? "",
      allergies: sub.allergies ?? "",
      attendance_type: sub.attendance_type ?? "",
      payment_method: sub.payment_method ?? "",
      guardian_name: sub.guardian_name ?? "",
      guardian_phone_1: sub.guardian_phone_1 ?? "",
      guardian_phone_2: sub.guardian_phone_2 ?? "",
      guardian_email: sub.guardian_email ?? "",
      guardian_name_2: sub.guardian_name_2 ?? "",
      guardian_phone_3: sub.guardian_phone_3 ?? "",
      guardian_phone_4: sub.guardian_phone_4 ?? "",
      guardian_email_2: sub.guardian_email_2 ?? "",
    });
  }

  function setRE(key: string, val: string) {
    setReviewEdit((prev) => ({ ...prev, [key]: val }));
  }

  const fetchSubmissions = useCallback(async () => {
    try {
      const res = await axios.get<EnrollmentSubmission[]>("/api/enrollment/submissions");
      setSubmissions(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (classFilter) params.set("classId", classFilter);
      if (statusFilter) params.set("paymentStatus", statusFilter);
      if (genderFilter) params.set("gender", genderFilter);
      const res = await axios.get<Student[]>(`/api/students?${params}`);
      setStudents(res.data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [search, classFilter, statusFilter, genderFilter]);

  const fetchTodayAttendance = useCallback(async () => {
    try {
      const res = await axios.get<Array<{ studentId: string; id: string; checkinAt: string | null; checkoutAt: string | null }>>("/api/attendance/students/today");
      const map: Record<string, { id: string; checkinAt: string | null; checkoutAt: string | null }> = {};
      res.data.forEach((a) => { map[a.studentId] = a; });
      setTodayAtt(map);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    axios.get<Class[]>("/api/classes").then((r) => setClasses(r.data)).catch(() => {});
    fetchTodayAttendance();
    fetchSubmissions();
  }, [fetchTodayAttendance, fetchSubmissions]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(fetchStudents, 300);
  }, [fetchStudents]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === students.length) setSelected(new Set());
    else setSelected(new Set(students.map((s) => s.id)));
  };

  async function checkin(studentId: string) {
    try {
      await axios.post("/api/attendance/students/checkin", { student_id: studentId });
      fetchTodayAttendance();
    } catch { /* ignore */ }
  }
  async function checkout(studentId: string) {
    try {
      await axios.post("/api/attendance/students/checkout", { student_id: studentId });
      fetchTodayAttendance();
    } catch { /* ignore */ }
  }
  async function sendReminder(id: string) {
    await axios.post(`/api/students/${id}/reminder`);
    alert(t("common.sent"));
  }

  async function sendEnrollmentForm() {
    setEnrollSending(true);
    setEnrollSuccess(null);
    setEnrollError(null);
    try {
      const res = await axios.post<{ success: boolean; email: string }>("/api/enrollment/create-token", {
        email: enrollEmail,
      });
      // The address, because that is where the link actually went.
      setEnrollSuccess(res.data.email);
      setEnrollEmail("");
    } catch (err) {
      setEnrollError(axios.isAxiosError(err) ? err.response?.data?.error ?? t("common.somethingWentWrong") : t("common.somethingWentWrong"));
    } finally {
      setEnrollSending(false);
    }
  }

  async function approveSubmission() {
    if (!reviewModalSub) return;
    setReviewApproving(true);
    try {
      const { date_of_birth_str, ...rest } = reviewEdit as Record<string, string>;
      await axios.post(`/api/enrollment/approve/${reviewModalSub.id}`, {
        ...rest,
        class_id: reviewClassId || undefined,
        date_of_birth: date_of_birth_str || undefined,
      });
      setReviewModalSub(null);
      setReviewClassId("");
      setReviewEdit({});
      fetchSubmissions();
      fetchStudents();
    } catch (err) {
      alert(axios.isAxiosError(err) ? err.response?.data?.error ?? t("common.somethingWentWrong") : t("common.somethingWentWrong"));
    } finally {
      setReviewApproving(false);
    }
  }

  async function rejectSubmission(id: string) {
    setReviewRejecting(true);
    try {
      await axios.post(`/api/enrollment/reject/${id}`);
      setReviewModalSub(null);
      fetchSubmissions();
    } catch { /* ignore */ }
    finally { setReviewRejecting(false); }
  }

  async function applyBulk() {
    const ids = Array.from(selected);
    if (!bulkAction || ids.length === 0) return;

    if (bulkAction === "extend_subscription") {
      setShowExtendModal(true);
      return;
    }

    if (["checkin", "checkout", "reminder"].includes(bulkAction)) {
      for (const id of ids) {
        if (bulkAction === "checkin") await axios.post("/api/attendance/students/checkin", { student_id: id }).catch(() => {});
        if (bulkAction === "checkout") await axios.post("/api/attendance/students/checkout", { student_id: id }).catch(() => {});
        if (bulkAction === "reminder") await axios.post(`/api/students/${id}/reminder`).catch(() => {});
      }
    } else if ((PAYMENT_STATUSES as string[]).includes(bulkAction)) {
      // No longer silent: a rejected bulk update used to be swallowed whole, so
      // the list simply refreshed unchanged with no indication anything failed.
      try {
        await axios.put("/api/students/bulk-status", { ids, paymentStatus: bulkAction });
      } catch (err) {
        alert(describeApiError(err, t("students.changeStatusFailed")));
      }
    }

    fetchStudents();
    fetchTodayAttendance();
    setSelected(new Set());
    setBulkAction("");
  }

  async function handleExtendSubscription() {
    const ids = Array.from(selected);
    if (!newEndDate || ids.length === 0) return;
    setIsExtending(true);
    try {
      await axios.post("/api/students/bulk-extend", { ids, enrollmentEndDate: newEndDate });
      setShowExtendModal(false);
      setNewEndDate("");
      setSelected(new Set());
      setBulkAction("");
      fetchStudents();
    } catch (err) {
      alert(axios.isAxiosError(err) ? err.response?.data?.error ?? t("common.somethingWentWrong") : t("common.somethingWentWrong"));
    } finally {
      setIsExtending(false);
    }
  }

  async function handleXlsxUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setXlsxUploading(true);
    setXlsxResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post<{ added: number; failed: number; errors: string[] }>("/api/students/bulk", fd);
      setXlsxResult(res.data);
      fetchStudents();
    } catch (err) {
      setXlsxResult({ added: 0, failed: 1, errors: [axios.isAxiosError(err) ? err.response?.data?.error ?? t("common.error") : t("common.error")] });
    } finally {
      setXlsxUploading(false);
      if (xlsxInputRef.current) xlsxInputRef.current.value = "";
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={t("students.title")} />
      <div className="p-6">

        {/* ── Enrollment Submissions Review Queue ── */}
        {submissions.length > 0 && (
          <div className="mb-5 bg-white rounded-xl shadow-md overflow-hidden border border-amber-200">
            <button
              onClick={() => setSubmissionsExpanded((p) => !p)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-amber-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-[#111111]">{t("students.pendingRequests")}</span>
                <span className="px-2.5 py-0.5 bg-amber-500 text-white text-xs font-bold rounded-full">
                  {t("students.newRequestsCount", { count: submissions.length })}
                </span>
              </div>
              <span className="text-gray-400 text-xs">{submissionsExpanded ? "▲" : "▼"}</span>
            </button>
            {submissionsExpanded && (
              <div className="overflow-x-auto border-t border-amber-100">
                <table className="w-full text-sm">
                  <thead className="bg-amber-50 text-right">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-gray-700">{t("students.fullName")}</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">{t("students.guardianName")}</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">{t("students.guardianPhone")}</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">{t("students.attendanceType")}</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">{t("students.submittedAt")}</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((sub) => (
                      <tr key={sub.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-[#111111]">{sub.full_name}</td>
                        <td className="px-4 py-3 text-gray-600">{sub.guardian_name ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs" dir="ltr">{sub.guardian_phone_1 ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-600">{sub.attendance_type ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {new Date(sub.submitted_at).toLocaleDateString("ar-SA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openReviewModal(sub)}
                              className="px-3 py-1.5 text-xs bg-[#111111] text-white rounded-lg hover:bg-[#2a3460] transition-colors"
                            >
                              {t("common.review")}
                            </button>
                            <button
                              onClick={() => rejectSubmission(sub.id)}
                              disabled={reviewRejecting}
                              className="px-3 py-1.5 text-xs border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                            >
                              {t("common.reject")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <input
            type="text"
            placeholder={t("students.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111] min-w-[200px]"
          />
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
          >
            <option value="">{t("students.filterByClass")}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
          >
            <option value="">{t("students.filterByStatus")}</option>
            <option value="PAID">{t("paymentStatus.PAID")}</option>
            <option value="LATE">{t("paymentStatus.LATE")}</option>
            <option value="CANCELLED">{t("paymentStatus.CANCELLED")}</option>
            {/* Was `value="بانتظار الدفع"`. The column is an enum of English
                identifiers, so the Arabic literal matched no row and the filter
                silently returned nothing. */}
            <option value="PENDING">{t("paymentStatus.PENDING")}</option>
          </select>
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
          >
            <option value="">{t("common.all")}</option>
            <option value="MALE">{t("common.boys")}</option>
            <option value="FEMALE">{t("common.girls")}</option>
          </select>

          {/* Bulk action */}
          <div className="flex items-center gap-2">
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
            >
              <option value="">{t("students.bulkAction")}</option>
              <option value="checkin">{t("students.bulkCheckin")}</option>
              <option value="checkout">{t("students.bulkCheckout")}</option>
              <option value="reminder">{t("students.bulkReminder")}</option>
              <option value="PAID">{t("students.setStatus", { status: t("paymentStatus.PAID") })}</option>
              <option value="LATE">{t("students.setStatus", { status: t("paymentStatus.LATE") })}</option>
              <option value="CANCELLED">{t("students.setStatus", { status: t("paymentStatus.CANCELLED") })}</option>
              {/* Same fix: `bulk-status` validates against the enum, so the
                  Arabic value was rejected with a 422 that the `.catch(() => {})`
                  below swallowed — the action appeared to work and changed
                  nothing. */}
              <option value="PENDING">{t("students.setStatus", { status: t("paymentStatus.PENDING") })}</option>
              <option value="extend_subscription">{t("students.extendSubscription")}</option>
            </select>
            <button
              onClick={applyBulk}
              disabled={!bulkAction || selected.size === 0}
              className="px-3 py-2 bg-[#111111] text-white rounded-lg text-sm disabled:opacity-40"
            >
              {t("common.apply")}
            </button>
          </div>

          {/* Add student dropdown button */}
          <div className="relative mr-auto" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1 px-4 py-2 bg-[#F64651] text-white rounded-lg text-sm font-medium hover:bg-[#D93A44] transition-colors"
            >
              + {t("students.addStudent")}
              <span className="text-xs mr-1">▼</span>
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-white rounded-xl shadow-lg border border-gray-100 z-30 overflow-hidden">
                <button
                  onClick={() => { setDropdownOpen(false); router.push("/students/new"); }}
                  className="w-full text-right px-4 py-3 text-sm text-[#111111] hover:bg-gray-50 transition-colors border-b border-gray-100"
                >
                  {t("students.addStudentManually")}
                </button>
                <button
                  onClick={() => { setDropdownOpen(false); router.push("/students/import"); }}
                  className="w-full text-right px-4 py-3 text-sm text-[#111111] hover:bg-gray-50 transition-colors border-b border-gray-100"
                >
                  {t("students.uploadStudentsFile")}
                </button>
                <button
                  onClick={() => { setDropdownOpen(false); setEnrollmentModalOpen(true); setEnrollSuccess(null); setEnrollError(null); }}
                  className="w-full text-right px-4 py-3 text-sm text-[#F64651] font-medium hover:bg-success-bg transition-colors"
                >
                  {t("students.sendRegistrationForm")}
                </button>
              </div>
            )}
          </div>

          <input
            ref={xlsxInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleXlsxUpload}
          />
        </div>

        {/* XLSX upload result */}
        {xlsxUploading && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            {t("common.processing")}
          </div>
        )}
        {xlsxResult && (
          <div className={`mb-4 p-4 rounded-lg text-sm border ${xlsxResult.failed > 0 ? "bg-orange-50 border-orange-200" : "bg-success-bg border-success-text/20"}`}>
            <p className="font-medium mb-1">
              <span className="text-success-text">{t("students.imported", { count: xlsxResult.added })}</span>
              {xlsxResult.failed > 0 && <> · <span className="text-red-600">{t("students.importFailed", { count: xlsxResult.failed })}</span></>}
            </p>
            {xlsxResult.errors.length > 0 && (
              <ul className="text-xs text-red-600 mt-1 space-y-0.5">
                {xlsxResult.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                {xlsxResult.errors.length > 5 && <li>{t("students.andMoreErrors", { count: xlsxResult.errors.length - 5 })}</li>}
              </ul>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <div className="w-7 h-7 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 text-right">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === students.length && students.length > 0}
                      onChange={toggleAll}
                      className="w-4 h-4"
                    />
                  </th>
                  <th className="px-3 py-3 w-40">{t("students.attendanceColumn")}</th>
                  <th className="px-4 py-3">{t("students.columns.name")}</th>
                  <th className="px-4 py-3">{t("students.columns.paymentStatus")}</th>
                  <th className="px-4 py-3">{t("students.columns.period")}</th>
                  <th className="px-4 py-3">{t("students.columns.class")}</th>
                  <th className="px-4 py-3">{t("students.columns.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState title={t("students.noStudentsYet")} description={t("students.noStudentsHint")} />
                    </td>
                  </tr>
                )}
                {students.map((student) => {
                  const att = todayAtt[student.id] ?? null;
                  const checkedIn = !!att?.checkinAt;
                  const checkedOut = !!att?.checkoutAt;

                  return (
                    <tr key={student.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(student.id)}
                          onChange={() => toggleSelect(student.id)}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1.5">
                          {checkedIn && !checkedOut && att?.checkinAt ? (
                            <>
                              <LiveTimer from={att.checkinAt} />
                              <button
                                onClick={() => checkout(student.id)}
                                className="px-2 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors whitespace-nowrap"
                              >
                                {t("students.actions.checkout")}
                              </button>
                            </>
                          ) : checkedIn && checkedOut && att?.checkinAt && att?.checkoutAt ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-gray-500">{t("students.checkedInAt", { time: formatTime(att.checkinAt, locale) })}</span>
                              <span className="text-xs text-gray-400">{t("students.checkedOutAt", { time: formatTime(att.checkoutAt, locale) })}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-sm text-gray-300">00:00</span>
                              <button
                                onClick={() => checkin(student.id)}
                                className="px-2 py-1 text-xs bg-success-bg text-success-text border border-success-text/20 rounded-lg hover:bg-success-bg transition-colors whitespace-nowrap"
                              >
                                {t("students.actions.checkin")}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {student.avatarUrl ? (
                            <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
                              <img src={student.avatarUrl} alt={student.name} className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <AvatarPlaceholder name={student.name} />
                          )}
                          <span className="font-medium text-[#111111]">{student.name}</span>
                          {!student.isActive && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t("students.suspended")}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge status={student.paymentStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <PeriodBadge period={student.period} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <span className="inline-flex items-center gap-1.5">
                          {student.class?.name ?? "—"}
                          {(student.needsClassWarning || !student.classId) && (
                            <span
                              title={t("students.noClassAssigned")}
                              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-xs"
                            >
                              ⚠
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => router.push(`/students/${student.id}`)}
                            className="px-2.5 py-1 text-xs border border-[#111111] text-[#111111] rounded-lg hover:bg-[#111111] hover:text-white transition-colors"
                          >
                            {t("students.actions.viewMore")}
                          </button>
                          <button
                            onClick={() => sendReminder(student.id)}
                            className="px-2.5 py-1 text-xs border border-blue-500 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                          >
                            {t("students.actions.sendReminder")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Extend Subscription Modal ── */}
      {showExtendModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowExtendModal(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[#111111] text-right mb-4">{t("students.extendSubscription")}</h3>
            <p className="text-sm text-gray-500 text-right mb-4">
              {t("students.newEndDatePrompt")}
              <span className="text-gray-400 text-xs block mt-0.5">
                {t("students.appliesToSelected", { count: selected.size })}
              </span>
            </p>
            <input
              type="date"
              dir="ltr"
              value={newEndDate}
              onChange={(e) => setNewEndDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#F64651]"
            />
            <div className="flex gap-3 justify-start">
              <button
                onClick={() => { setShowExtendModal(false); setNewEndDate(""); }}
                className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleExtendSubscription}
                disabled={!newEndDate || isExtending}
                className="px-4 py-2.5 rounded-lg bg-[#F64651] text-white text-sm hover:bg-[#D93A44] disabled:opacity-50 transition-colors"
              >
                {isExtending ? t("common.updating") : t("common.approve")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Enrollment Send Modal ── */}
      {enrollmentModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEnrollmentModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[#111111] mb-4">{t("students.sendFormTitle")}</h2>
            {enrollSuccess ? (
              <div className="text-center py-4">
                <div className="w-14 h-14 bg-success-bg rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">✓</span>
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  {t("students.linkSentTo")} <span dir="ltr" className="font-mono">{enrollSuccess}</span>
                </p>
                <button
                  onClick={() => setEnrollmentModalOpen(false)}
                  className="mt-4 w-full py-2.5 bg-[#111111] text-white rounded-xl text-sm font-medium"
                >
                  إغلاق
                </button>
              </div>
            ) : (
              <>
                {/* The phone field was removed: nothing sent a message to it,
                    nothing copied it onto the guardian's record, and nothing
                    prefilled it into the form. It was a required step that
                    returned nothing. The parent still gives their number inside
                    the form itself, which is unchanged. */}
                <div className="mb-5">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("common.email")} <span className="text-red-500">*</span></label>
                  <input
                    type="email"
                    dir="ltr"
                    value={enrollEmail}
                    onChange={(e) => setEnrollEmail(e.target.value)}
                    placeholder="example@email.com"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]"
                  />
                  <p className="mt-1.5 text-xs text-gray-500">
                    {t("students.formEmailHint")}
                  </p>
                </div>
                {enrollError && (
                  <p className="mb-3 text-sm text-red-600 bg-red-50 p-2.5 rounded-lg">{enrollError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={sendEnrollmentForm}
                    disabled={enrollSending || !enrollEmail.trim()}
                    className="flex-1 py-2.5 bg-[#F64651] text-white rounded-xl text-sm font-medium hover:bg-[#D93A44] disabled:opacity-50 transition-colors"
                  >
                    {enrollSending ? t("common.sending") : t("students.sendLink")}
                  </button>
                  <button
                    onClick={() => setEnrollmentModalOpen(false)}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                  >
                    إلغاء
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Review Submission Modal ── */}
      {reviewModalSub && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setReviewModalSub(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-[#111111]">{t("students.reviewRequestTitle")}</h2>
              <button onClick={() => setReviewModalSub(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {/* Student Info */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-700">{t("students.studentInfo")}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t("students.fullName")} *</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.full_name ?? ""} onChange={(e) => setRE("full_name", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t("students.idNumber")}</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.id_number ?? ""} onChange={(e) => setRE("id_number", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t("students.nationality")}</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.nationality ?? ""} onChange={(e) => setRE("nationality", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t("students.academicStage")}</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.academic_stage ?? ""} onChange={(e) => setRE("academic_stage", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجنس</label>
                  <select className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.gender ?? ""} onChange={(e) => setRE("gender", e.target.value)}>
                    <option value="">—</option>
                    <option value="ذكر">ذكر</option>
                    <option value="أنثى">أنثى</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الفترة</label>
                  <select className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.period ?? ""} onChange={(e) => setRE("period", e.target.value)}>
                    <option value="">—</option>
                    <option value="صباحي">صباحي</option>
                    <option value="مسائي">مسائي</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">تاريخ الميلاد</label>
                  <input type="date" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={(reviewEdit as Record<string, string>).date_of_birth_str ?? ""} onChange={(e) => setRE("date_of_birth_str", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Health Info */}
            <div className="bg-red-50 rounded-xl p-4 mb-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-700">المعلومات الصحية</h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">الحالة الصحية</label>
                <textarea className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651] resize-none h-16" value={reviewEdit.health_condition ?? ""} onChange={(e) => setRE("health_condition", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">الحساسيات</label>
                <textarea className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651] resize-none h-16" value={reviewEdit.allergies ?? ""} onChange={(e) => setRE("allergies", e.target.value)} />
              </div>
            </div>

            {/* Guardian Info */}
            <div className="bg-blue-50 rounded-xl p-4 mb-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-700">معلومات ولي الأمر</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">{t("students.guardianName")}</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.guardian_name ?? ""} onChange={(e) => setRE("guardian_name", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجوال 1</label>
                  <input dir="ltr" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.guardian_phone_1 ?? ""} onChange={(e) => setRE("guardian_phone_1", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجوال 2</label>
                  <input dir="ltr" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.guardian_phone_2 ?? ""} onChange={(e) => setRE("guardian_phone_2", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">البريد الإلكتروني</label>
                  <input dir="ltr" type="email" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.guardian_email ?? ""} onChange={(e) => setRE("guardian_email", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">اسم ولي الأمر 2</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.guardian_name_2 ?? ""} onChange={(e) => setRE("guardian_name_2", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجوال 3</label>
                  <input dir="ltr" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.guardian_phone_3 ?? ""} onChange={(e) => setRE("guardian_phone_3", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجوال 4</label>
                  <input dir="ltr" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.guardian_phone_4 ?? ""} onChange={(e) => setRE("guardian_phone_4", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Registration Info */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-700">معلومات التسجيل</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t("students.attendanceType")}</label>
                  <select className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.attendance_type ?? ""} onChange={(e) => setRE("attendance_type", e.target.value)}>
                    <option value="">—</option>
                    <option value="دوام منتظم">دوام منتظم</option>
                    <option value="شفتات">شفتات</option>
                    <option value="غيره">غيره</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">طريقة الدفع</label>
                  <select className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F64651]" value={reviewEdit.payment_method ?? ""} onChange={(e) => setRE("payment_method", e.target.value)}>
                    <option value="">—</option>
                    <option value="نقدي">نقدي</option>
                    <option value="تحويل">تحويل</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Class assignment */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">تعيين الفصل</label>
              <select
                value={reviewClassId}
                onChange={(e) => setReviewClassId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]"
              >
                <option value="">بدون فصل</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={approveSubmission}
                disabled={reviewApproving}
                className="flex-1 py-3 bg-[#F64651] text-white rounded-xl text-sm font-bold hover:bg-[#D93A44] disabled:opacity-50 transition-colors"
              >
                {reviewApproving ? "جاري القبول..." : "قبول وتفعيل"}
              </button>
              <button
                onClick={() => rejectSubmission(reviewModalSub.id)}
                disabled={reviewRejecting}
                className="flex-1 py-3 border-2 border-red-300 text-red-600 rounded-xl text-sm font-bold hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {reviewRejecting ? "..." : "رفض"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
