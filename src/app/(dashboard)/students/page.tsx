"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { PaymentStatusBadge, PeriodBadge } from "@/components/ui/StatusBadge";
import { AvatarPlaceholder } from "@/components/ui/IconPlaceholder";
import { t, formatTime } from "@/lib/utils";

type Student = {
  id: string;
  name: string;
  period: "MORNING" | "EVENING";
  paymentStatus: "PAID" | "LATE" | "CANCELLED" | "SUSPENDED";
  class?: { id: string; name: string } | null;
  guardian?: { id: string; name: string; phone1?: string | null; phone2?: string | null; email?: string | null } | null;
  isActive: boolean;
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
    <span className="font-mono text-sm font-semibold text-emerald-700 tabular-nums">
      {fmt(h)}:{fmt(m)}:{fmt(s)}
    </span>
  );
}

export default function StudentsPage() {
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
  const [xlsxUploading, setXlsxUploading] = useState(false);
  const [xlsxResult, setXlsxResult] = useState<{ added: number; failed: number; errors: string[] } | null>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Enrollment
  const [enrollmentModalOpen, setEnrollmentModalOpen] = useState(false);
  const [enrollPhone, setEnrollPhone] = useState("");
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
    alert("تم الإرسال");
  }

  async function sendEnrollmentForm() {
    setEnrollSending(true);
    setEnrollSuccess(null);
    setEnrollError(null);
    try {
      const res = await axios.post<{ success: boolean; phone: string }>("/api/enrollment/create-token", {
        phone: enrollPhone,
        email: enrollEmail,
      });
      setEnrollSuccess(res.data.phone);
      setEnrollPhone("");
      setEnrollEmail("");
    } catch (err) {
      setEnrollError(axios.isAxiosError(err) ? err.response?.data?.error ?? "حدث خطأ" : "حدث خطأ");
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
      alert(axios.isAxiosError(err) ? err.response?.data?.error ?? "حدث خطأ" : "حدث خطأ");
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

    if (["checkin", "checkout", "reminder"].includes(bulkAction)) {
      for (const id of ids) {
        if (bulkAction === "checkin") await axios.post("/api/attendance/students/checkin", { student_id: id }).catch(() => {});
        if (bulkAction === "checkout") await axios.post("/api/attendance/students/checkout", { student_id: id }).catch(() => {});
        if (bulkAction === "reminder") await axios.post(`/api/students/${id}/reminder`).catch(() => {});
      }
    } else if (["PAID", "LATE", "CANCELLED", "SUSPENDED", "بانتظار الدفع"].includes(bulkAction)) {
      await axios.put("/api/students/bulk-status", { ids, paymentStatus: bulkAction }).catch(() => {});
    }

    fetchStudents();
    fetchTodayAttendance();
    setSelected(new Set());
    setBulkAction("");
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
      setXlsxResult({ added: 0, failed: 1, errors: [axios.isAxiosError(err) ? err.response?.data?.error ?? "خطأ" : "خطأ"] });
    } finally {
      setXlsxUploading(false);
      if (xlsxInputRef.current) xlsxInputRef.current.value = "";
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#f4f6fb]">
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
                <span className="text-sm font-bold text-[#1a2340]">طلبات التسجيل المعلقة</span>
                <span className="px-2.5 py-0.5 bg-amber-500 text-white text-xs font-bold rounded-full">
                  {submissions.length} طلبات جديدة
                </span>
              </div>
              <span className="text-gray-400 text-xs">{submissionsExpanded ? "▲" : "▼"}</span>
            </button>
            {submissionsExpanded && (
              <div className="overflow-x-auto border-t border-amber-100">
                <table className="w-full text-sm">
                  <thead className="bg-amber-50 text-right">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-gray-700">اسم الطالب</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">اسم ولي الأمر</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">رقم الجوال</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">طبيعة الدوام</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">وقت التقديم</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((sub) => (
                      <tr key={sub.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-[#1a2340]">{sub.full_name}</td>
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
                              className="px-3 py-1.5 text-xs bg-[#1a2340] text-white rounded-lg hover:bg-[#2a3460] transition-colors"
                            >
                              مراجعة
                            </button>
                            <button
                              onClick={() => rejectSubmission(sub.id)}
                              disabled={reviewRejecting}
                              className="px-3 py-1.5 text-xs border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                            >
                              رفض
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
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340] min-w-[200px]"
          />
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
          >
            <option value="">{t("students.filterByClass")}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
          >
            <option value="">{t("students.filterByStatus")}</option>
            <option value="PAID">{t("paymentStatus.PAID")}</option>
            <option value="LATE">{t("paymentStatus.LATE")}</option>
            <option value="CANCELLED">{t("paymentStatus.CANCELLED")}</option>
            <option value="SUSPENDED">{t("paymentStatus.SUSPENDED")}</option>
            <option value="بانتظار الدفع">بانتظار الدفع</option>
          </select>
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
          >
            <option value="">الكل</option>
            <option value="MALE">بنين</option>
            <option value="FEMALE">بنات</option>
          </select>

          {/* Bulk action */}
          <div className="flex items-center gap-2">
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
            >
              <option value="">{t("students.bulkAction")}</option>
              <option value="checkin">{t("students.bulkCheckin")}</option>
              <option value="checkout">{t("students.bulkCheckout")}</option>
              <option value="reminder">{t("students.bulkReminder")}</option>
              <option value="PAID">تغيير الحالة: مدفوع</option>
              <option value="LATE">تغيير الحالة: متأخر</option>
              <option value="CANCELLED">تغيير الحالة: ملغي</option>
              <option value="SUSPENDED">تغيير الحالة: موقف</option>
              <option value="بانتظار الدفع">تغيير الحالة: بانتظار الدفع</option>
            </select>
            <button
              onClick={applyBulk}
              disabled={!bulkAction || selected.size === 0}
              className="px-3 py-2 bg-[#1a2340] text-white rounded-lg text-sm disabled:opacity-40"
            >
              تنفيذ
            </button>
          </div>

          {/* Add student dropdown button */}
          <div className="relative mr-auto" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1 px-4 py-2 bg-[#22c55e] text-white rounded-lg text-sm font-medium hover:bg-[#16a34a] transition-colors"
            >
              + {t("students.addStudent")}
              <span className="text-xs mr-1">▼</span>
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-white rounded-xl shadow-lg border border-gray-100 z-30 overflow-hidden">
                <button
                  onClick={() => { setDropdownOpen(false); router.push("/students/new"); }}
                  className="w-full text-right px-4 py-3 text-sm text-[#1a2340] hover:bg-gray-50 transition-colors border-b border-gray-100"
                >
                  أضف طالب جديد
                </button>
                <button
                  onClick={() => { setDropdownOpen(false); router.push("/students/import"); }}
                  className="w-full text-right px-4 py-3 text-sm text-[#1a2340] hover:bg-gray-50 transition-colors border-b border-gray-100"
                >
                  ارفع ملف الطلاب
                </button>
                <button
                  onClick={() => { setDropdownOpen(false); setEnrollmentModalOpen(true); setEnrollSuccess(null); setEnrollError(null); }}
                  className="w-full text-right px-4 py-3 text-sm text-[#22c55e] font-medium hover:bg-green-50 transition-colors"
                >
                  إنشاء نموذج جديد
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
            جاري معالجة الملف...
          </div>
        )}
        {xlsxResult && (
          <div className={`mb-4 p-4 rounded-lg text-sm border ${xlsxResult.failed > 0 ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200"}`}>
            <p className="font-medium mb-1">
              تمت الإضافة: <span className="text-green-700">{xlsxResult.added} طالب</span>
              {xlsxResult.failed > 0 && <> · فشل: <span className="text-red-600">{xlsxResult.failed} صف</span></>}
            </p>
            {xlsxResult.errors.length > 0 && (
              <ul className="text-xs text-red-600 mt-1 space-y-0.5">
                {xlsxResult.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                {xlsxResult.errors.length > 5 && <li>...و {xlsxResult.errors.length - 5} أخطاء أخرى</li>}
              </ul>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <div className="w-7 h-7 border-2 border-gray-200 border-t-[#22c55e] rounded-full animate-spin" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#1a2340] text-white text-right">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === students.length && students.length > 0}
                      onChange={toggleAll}
                      className="w-4 h-4"
                    />
                  </th>
                  <th className="px-3 py-3 w-40">الحضور</th>
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
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      {t("common.noData")}
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
                                تسجيل الخروج
                              </button>
                            </>
                          ) : checkedIn && checkedOut && att?.checkinAt && att?.checkoutAt ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-gray-500">دخل {formatTime(att.checkinAt)}</span>
                              <span className="text-xs text-gray-400">خرج {formatTime(att.checkoutAt)}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-sm text-gray-300">00:00</span>
                              <button
                                onClick={() => checkin(student.id)}
                                className="px-2 py-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap"
                              >
                                تسجيل الوصول
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <AvatarPlaceholder name={student.name} />
                          <span className="font-medium text-[#1a2340]">{student.name}</span>
                          {!student.isActive && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">موقوف</span>
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
                        {student.class?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => router.push(`/students/${student.id}`)}
                            className="px-2.5 py-1 text-xs border border-[#1a2340] text-[#1a2340] rounded-lg hover:bg-[#1a2340] hover:text-white transition-colors"
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

      {/* ── Enrollment Send Modal ── */}
      {enrollmentModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEnrollmentModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[#1a2340] mb-4">إرسال نموذج التسجيل</h2>
            {enrollSuccess ? (
              <div className="text-center py-4">
                <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">✓</span>
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  تم إرسال الرابط إلى <span dir="ltr" className="font-mono">{enrollSuccess}</span>
                </p>
                <button
                  onClick={() => setEnrollmentModalOpen(false)}
                  className="mt-4 w-full py-2.5 bg-[#1a2340] text-white rounded-xl text-sm font-medium"
                >
                  إغلاق
                </button>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">رقم الجوال <span className="text-red-500">*</span></label>
                  <div className="flex gap-2">
                    <span className="flex items-center px-3 bg-gray-100 border border-gray-200 rounded-xl text-sm text-gray-500 font-mono">966+</span>
                    <input
                      type="tel"
                      dir="ltr"
                      value={enrollPhone}
                      onChange={(e) => setEnrollPhone(e.target.value)}
                      placeholder="5xxxxxxxx"
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
                    />
                  </div>
                </div>
                <div className="mb-5">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">البريد الإلكتروني <span className="text-gray-400 text-xs">(اختياري)</span></label>
                  <input
                    type="email"
                    dir="ltr"
                    value={enrollEmail}
                    onChange={(e) => setEnrollEmail(e.target.value)}
                    placeholder="example@email.com"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
                  />
                </div>
                {enrollError && (
                  <p className="mb-3 text-sm text-red-600 bg-red-50 p-2.5 rounded-lg">{enrollError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={sendEnrollmentForm}
                    disabled={enrollSending || !enrollPhone.trim()}
                    className="flex-1 py-2.5 bg-[#22c55e] text-white rounded-xl text-sm font-medium hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
                  >
                    {enrollSending ? "جاري الإرسال..." : "إرسال الرابط"}
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
              <h2 className="text-lg font-bold text-[#1a2340]">مراجعة طلب التسجيل</h2>
              <button onClick={() => setReviewModalSub(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {/* Student Info */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-700">معلومات الطالب</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الاسم الكامل *</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.full_name ?? ""} onChange={(e) => setRE("full_name", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">رقم الهوية</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.id_number ?? ""} onChange={(e) => setRE("id_number", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجنسية</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.nationality ?? ""} onChange={(e) => setRE("nationality", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">المرحلة الدراسية</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.academic_stage ?? ""} onChange={(e) => setRE("academic_stage", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجنس</label>
                  <select className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.gender ?? ""} onChange={(e) => setRE("gender", e.target.value)}>
                    <option value="">—</option>
                    <option value="ذكر">ذكر</option>
                    <option value="أنثى">أنثى</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الفترة</label>
                  <select className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.period ?? ""} onChange={(e) => setRE("period", e.target.value)}>
                    <option value="">—</option>
                    <option value="صباحي">صباحي</option>
                    <option value="مسائي">مسائي</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">تاريخ الميلاد</label>
                  <input type="date" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={(reviewEdit as Record<string, string>).date_of_birth_str ?? ""} onChange={(e) => setRE("date_of_birth_str", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Health Info */}
            <div className="bg-red-50 rounded-xl p-4 mb-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-700">المعلومات الصحية</h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">الحالة الصحية</label>
                <textarea className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e] resize-none h-16" value={reviewEdit.health_condition ?? ""} onChange={(e) => setRE("health_condition", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">الحساسيات</label>
                <textarea className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e] resize-none h-16" value={reviewEdit.allergies ?? ""} onChange={(e) => setRE("allergies", e.target.value)} />
              </div>
            </div>

            {/* Guardian Info */}
            <div className="bg-blue-50 rounded-xl p-4 mb-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-700">معلومات ولي الأمر</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">اسم ولي الأمر</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.guardian_name ?? ""} onChange={(e) => setRE("guardian_name", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجوال 1</label>
                  <input dir="ltr" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.guardian_phone_1 ?? ""} onChange={(e) => setRE("guardian_phone_1", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجوال 2</label>
                  <input dir="ltr" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.guardian_phone_2 ?? ""} onChange={(e) => setRE("guardian_phone_2", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">البريد الإلكتروني</label>
                  <input dir="ltr" type="email" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.guardian_email ?? ""} onChange={(e) => setRE("guardian_email", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">اسم ولي الأمر 2</label>
                  <input className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.guardian_name_2 ?? ""} onChange={(e) => setRE("guardian_name_2", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجوال 3</label>
                  <input dir="ltr" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.guardian_phone_3 ?? ""} onChange={(e) => setRE("guardian_phone_3", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">الجوال 4</label>
                  <input dir="ltr" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.guardian_phone_4 ?? ""} onChange={(e) => setRE("guardian_phone_4", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Registration Info */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-700">معلومات التسجيل</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">طبيعة الدوام</label>
                  <select className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.attendance_type ?? ""} onChange={(e) => setRE("attendance_type", e.target.value)}>
                    <option value="">—</option>
                    <option value="دوام منتظم">دوام منتظم</option>
                    <option value="شفتات">شفتات</option>
                    <option value="غيره">غيره</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">طريقة الدفع</label>
                  <select className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#22c55e]" value={reviewEdit.payment_method ?? ""} onChange={(e) => setRE("payment_method", e.target.value)}>
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
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
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
                className="flex-1 py-3 bg-[#22c55e] text-white rounded-xl text-sm font-bold hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
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
