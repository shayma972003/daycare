"use client";

import { useEffect, useState, use, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useForm } from "react-hook-form";
import { Topbar } from "@/components/layout/Topbar";
import { t, formatDate } from "@/lib/utils";
import { InvoiceModal } from "@/components/students/InvoiceModal";

type Class = { id: string; name: string };
type Invoice = {
  id: string;
  type: string;
  amount: number;
  pdfUrl?: string | null;
  createdAt: string;
};
type GuardianSuggestion = { id: string; name: string; phone1?: string | null; phone2?: string | null; email?: string | null; name_2?: string | null; phone_3?: string | null; phone_4?: string | null; email_2?: string | null };
type Sibling = { id: string; name: string };

type StudentData = {
  id: string;
  name: string;
  healthCondition: string | null;
  academicStage: string | null;
  period: string;
  classId: string | null;
  idNumber: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  gender: string;
  registrationDate: string;
  allergies: string | null;
  guardianId: string | null;
  guardian: { id: string; name: string; phone1?: string | null; phone2?: string | null; email?: string | null; name_2?: string | null; phone_3?: string | null; phone_4?: string | null; email_2?: string | null } | null;
  registration_fee: number;
  attendanceType: string;
  paymentMethod: string;
  enrollmentEndDate: string | null;
  paymentStatus: string;
  attendanceHours: number;
  lateHours: number;
  isActive: boolean;
  siblings: Sibling[];
};

type FormData = {
  name: string;
  healthCondition: string;
  academicStage: string;
  period: string;
  classId: string;
  idNumber: string;
  dateOfBirth: string;
  nationality: string;
  gender: string;
  allergies: string;
  guardianName: string;
  guardianPhone1: string;
  guardianPhone2: string;
  guardianEmail: string;
  guardianName2: string;
  guardianPhone3: string;
  guardianPhone4: string;
  guardianEmail2: string;
  registrationFee: string;
  attendanceType: string;
  paymentMethod: string;
  enrollmentEndDate: string;
  paymentStatus: string;
};

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340]";
const readonlyCls = "w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500";

export default function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [classes, setClasses] = useState<Class[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [student, setStudent] = useState<StudentData | null>(null);
  const [guardianId, setGuardianId] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [guardianLinked, setGuardianLinked] = useState(false);
  const [suggestions, setSuggestions] = useState<GuardianSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { register, handleSubmit, reset, watch } = useForm<FormData>();

  useEffect(() => {
    Promise.all([
      axios.get<StudentData>(`/api/students/${id}`),
      axios.get<Class[]>("/api/classes"),
      axios.get<Invoice[]>(`/api/invoices?studentId=${id}`),
    ])
      .then(([studentRes, classRes, invRes]) => {
        const s = studentRes.data;
        setStudent(s);
        setClasses(classRes.data);
        setInvoices(invRes.data);
        if (s.guardianId) {
          setGuardianId(s.guardianId);
          setGuardianLinked(true);
        }
        reset({
          name: s.name,
          healthCondition: s.healthCondition ?? "",
          academicStage: s.academicStage ?? "",
          period: s.period,
          classId: s.classId ?? "",
          idNumber: s.idNumber ?? "",
          dateOfBirth: s.dateOfBirth ? s.dateOfBirth.slice(0, 10) : "",
          nationality: s.nationality ?? "",
          gender: s.gender,
          allergies: s.allergies ?? "",
          guardianName: s.guardian?.name ?? "",
          guardianPhone1: s.guardian?.phone1 ?? "",
          guardianPhone2: s.guardian?.phone2 ?? "",
          guardianEmail: s.guardian?.email ?? "",
          guardianName2: s.guardian?.name_2 ?? "",
          guardianPhone3: s.guardian?.phone_3 ?? "",
          guardianPhone4: s.guardian?.phone_4 ?? "",
          guardianEmail2: s.guardian?.email_2 ?? "",
          registrationFee: String(s.registration_fee ?? 0),
          attendanceType: s.attendanceType ?? "دوام منتظم",
          paymentMethod: s.paymentMethod,
          enrollmentEndDate: s.enrollmentEndDate ? s.enrollmentEndDate.slice(0, 10) : "",
          paymentStatus: s.paymentStatus,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, reset]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchGuardians = useCallback((query: string) => {
    if (query.length < 3) { setSuggestions([]); setShowSuggestions(false); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await axios.post<GuardianSuggestion[]>("/api/guardians/search", { query });
        setSuggestions(res.data);
        setShowSuggestions(res.data.length > 0);
      } catch { /* ignore */ }
    }, 300);
  }, []);

  function handleGuardianFieldChange(value: string) {
    setGuardianId(null);
    setGuardianLinked(false);
    searchGuardians(value);
  }

  function handleGuardian2FieldChange(value: string) {
    if (value.length < 3) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await axios.post<GuardianSuggestion[]>("/api/guardians/search", { query: value });
        if (res.data.length === 1) selectGuardian(res.data[0]);
        else if (res.data.length > 1) { setSuggestions(res.data); setShowSuggestions(true); }
      } catch { /* ignore */ }
    }, 300);
  }

  function selectGuardian(g: GuardianSuggestion) {
    setGuardianId(g.id);
    setGuardianLinked(true);
    reset((prev) => ({
      ...prev,
      guardianName: g.name,
      guardianPhone1: g.phone1 ?? "",
      guardianPhone2: g.phone2 ?? "",
      guardianEmail: g.email ?? "",
      guardianName2: g.name_2 ?? "",
      guardianPhone3: g.phone_3 ?? "",
      guardianPhone4: g.phone_4 ?? "",
      guardianEmail2: g.email_2 ?? "",
    }));
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function onSave(data: FormData) {
    setSaving(true);
    try {
      await axios.put(`/api/students/${id}`, {
        name: data.name,
        classId: data.classId || null,
        healthCondition: data.healthCondition || null,
        academicStage: data.academicStage || null,
        period: data.period,
        idNumber: data.idNumber || null,
        dateOfBirth: data.dateOfBirth || null,
        nationality: data.nationality || null,
        gender: data.gender,
        allergies: data.allergies || null,
        attendanceType: data.attendanceType || "دوام منتظم",
        paymentMethod: data.paymentMethod,
        enrollmentEndDate: data.enrollmentEndDate || null,
        paymentStatus: data.paymentStatus,
        guardianId: guardianId || null,
        guardianName: data.guardianName || null,
        guardianPhone1: data.guardianPhone1 || null,
        guardianPhone2: data.guardianPhone2 || null,
        guardianEmail: data.guardianEmail || null,
        guardianName2: data.guardianName2 || null,
        guardianPhone3: data.guardianPhone3 || null,
        guardianPhone4: data.guardianPhone4 || null,
        guardianEmail2: data.guardianEmail2 || null,
        registration_fee: parseFloat(data.registrationFee) || 0,
      });
      alert("تم حفظ التغييرات");
    } catch {
      alert(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function sendReminder() {
    await axios.post(`/api/students/${id}/reminder`);
    alert("تم الإرسال");
  }

  async function deleteLateFee() {
    await axios.delete(`/api/students/${id}/late-fee`);
    alert("تم حذف رسوم التأخير");
    window.location.reload();
  }

  function issueInvoice() {
    setInvoiceModalOpen(true);
  }

  function onInvoiceIssued(invoice: { id: string; amount: number; pdfUrl: string | null; createdAt: string }) {
    setInvoices((prev) => [{ ...invoice, type: "STUDENT" }, ...prev]);
  }

  async function cancelStudent() {
    if (!confirm("هل أنت متأكد من إلغاء اشتراك هذا الطالب؟")) return;
    await axios.post(`/api/students/${id}/cancel`);
    window.location.reload();
  }

  async function reactivate() {
    await axios.post(`/api/students/${id}/reactivate`);
    window.location.reload();
  }

  const guardianNameVal = watch("guardianName");

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#f4f6fb]">
        <Topbar title={t("students.profile.title")} />
        <div className="flex justify-center items-center h-64">
          <div className="w-7 h-7 border-2 border-gray-200 border-t-[#22c55e] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#f4f6fb]">
      <Topbar title={t("students.profile.title")} />
      <div className="p-6">
        <button
          onClick={() => router.push("/students")}
          className="mb-4 text-sm text-[#1a2340] hover:underline flex items-center gap-1"
        >
          ← {t("students.title")}
        </button>

        <form onSubmit={handleSubmit(onSave)}>
          <div className="flex gap-5 flex-col lg:flex-row">
            {/* Left: cards */}
            <div className="flex-1 space-y-5">
              {/* Card 1: معلومات الطالب */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-bold text-[#1a2340]">معلومات الطالب</h2>
                  {/* Siblings */}
                  {student?.siblings && student.siblings.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400">أشقاء:</span>
                      {student.siblings.map((sib) => (
                        <button
                          key={sib.id}
                          type="button"
                          onClick={() => router.push(`/students/${sib.id}`)}
                          className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full hover:bg-blue-100 transition-colors"
                        >
                          {sib.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    ["name", t("students.profile.name"), "text"],
                    ["idNumber", t("students.profile.idNumber"), "text"],
                    ["nationality", t("students.profile.nationality"), "text"],
                    ["academicStage", t("students.profile.academicStage"), "text"],
                  ].map(([field, label, type]) => (
                    <div key={field}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                      <input {...register(field as keyof FormData)} type={type} className={inputCls} />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.gender")}</label>
                    <select {...register("gender")} className={inputCls}>
                      <option value="MALE">{t("gender.MALE")}</option>
                      <option value="FEMALE">{t("gender.FEMALE")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.period")}</label>
                    <select {...register("period")} className={inputCls}>
                      <option value="MORNING">{t("periods.MORNING")}</option>
                      <option value="EVENING">{t("periods.EVENING")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.class")}</label>
                    <select {...register("classId")} className={inputCls}>
                      <option value="">— {t("common.select")} —</option>
                      {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.dateOfBirth")}</label>
                    <input {...register("dateOfBirth")} type="date" dir="ltr" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.attendanceHours")}</label>
                    <input value={student?.attendanceHours ?? 0} readOnly className={readonlyCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.lateHours")}</label>
                    <input value={student?.lateHours ?? 0} readOnly className={readonlyCls} />
                  </div>
                </div>
              </div>

              {/* Card 2: المعلومات الصحية */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-base font-bold text-[#1a2340] mb-5">المعلومات الصحية</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.healthCondition")}</label>
                    <input {...register("healthCondition")} type="text" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.allergies")}</label>
                    <input {...register("allergies")} type="text" className={inputCls} />
                  </div>
                </div>
              </div>

              {/* Card 3: معلومات ولي الأمر */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-bold text-[#1a2340]">معلومات ولي الأمر</h2>
                  {guardianLinked && (
                    <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full font-medium">
                      تم ربط ولي الأمر الموجود
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.guardianName")}</label>
                    <input
                      {...register("guardianName")}
                      type="text"
                      className={inputCls}
                      autoComplete="off"
                      onChange={(e) => {
                        register("guardianName").onChange(e);
                        handleGuardianFieldChange(e.target.value);
                      }}
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div
                        ref={suggestionsRef}
                        className="absolute z-20 top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
                      >
                        {suggestions.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => selectGuardian(g)}
                            className="w-full text-right px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                          >
                            <div className="font-medium text-[#1a2340]">{g.name}</div>
                            <div className="text-xs text-gray-400">{[g.phone1, g.email].filter(Boolean).join(" · ")}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.phone1")}</label>
                    <input
                      {...register("guardianPhone1")}
                      type="tel"
                      dir="ltr"
                      className={inputCls}
                      onChange={(e) => {
                        register("guardianPhone1").onChange(e);
                        if (!guardianNameVal) handleGuardianFieldChange(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.phone2")}</label>
                    <input {...register("guardianPhone2")} type="tel" dir="ltr" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.email")}</label>
                    <input
                      {...register("guardianEmail")}
                      type="email"
                      dir="ltr"
                      className={inputCls}
                      onChange={(e) => {
                        register("guardianEmail").onChange(e);
                        if (!guardianNameVal) handleGuardianFieldChange(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">اسم ولي الأمر 2</label>
                    <input {...register("guardianName2")} type="text" className={inputCls}
                      onChange={(e) => { register("guardianName2").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">رقم الجوال 3</label>
                    <input {...register("guardianPhone3")} type="tel" dir="ltr" className={inputCls}
                      onChange={(e) => { register("guardianPhone3").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">رقم الجوال 4</label>
                    <input {...register("guardianPhone4")} type="tel" dir="ltr" className={inputCls}
                      onChange={(e) => { register("guardianPhone4").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">البريد الإلكتروني 2</label>
                    <input {...register("guardianEmail2")} type="email" dir="ltr" className={inputCls}
                      onChange={(e) => { register("guardianEmail2").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
                  </div>
                </div>
              </div>

              {/* Card 4: معلومات التسجيل */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-base font-bold text-[#1a2340] mb-5">معلومات التسجيل</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">طبيعة الدوام</label>
                    <select {...register("attendanceType")} className={inputCls}>
                      <option value="دوام منتظم">دوام منتظم</option>
                      <option value="شفتات">شفتات</option>
                      <option value="غيره">غيره</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.paymentMethod")}</label>
                    <select {...register("paymentMethod")} className={inputCls}>
                      <option value="CASH">{t("paymentMethod.CASH")}</option>
                      <option value="TRANSFER">{t("paymentMethod.TRANSFER")}</option>
                      <option value="CARD">{t("paymentMethod.CARD")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">حالة الدفع</label>
                    <select {...register("paymentStatus")} className={inputCls}>
                      <option value="PAID">{t("paymentStatus.PAID")}</option>
                      <option value="LATE">{t("paymentStatus.LATE")}</option>
                      <option value="CANCELLED">{t("paymentStatus.CANCELLED")}</option>
                      <option value="SUSPENDED">{t("paymentStatus.SUSPENDED")}</option>
                      <option value="بانتظار الدفع">بانتظار الدفع</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.enrollmentEndDate")}</label>
                    <input {...register("enrollmentEndDate")} type="date" dir="ltr" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">رسوم التسجيل</label>
                    <div className="relative">
                      <input {...register("registrationFee")} type="number" min="0" step="0.01" dir="ltr" className={`${inputCls} pl-14`} />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">ر.س</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: action sidebar */}
            <div className="w-full lg:w-64 space-y-3 self-start">
              <div className="bg-white rounded-xl shadow-md p-5 space-y-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2.5 bg-[#22c55e] text-white rounded-lg text-sm font-medium hover:bg-[#16a34a] disabled:opacity-60 transition-colors"
                >
                  {saving ? t("common.loading") : t("students.profile.actions.save")}
                </button>
                <button
                  type="button"
                  onClick={sendReminder}
                  className="w-full py-2.5 border border-blue-500 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-50 transition-colors"
                >
                  {t("students.profile.actions.sendPaymentReminder")}
                </button>
                <button
                  type="button"
                  onClick={deleteLateFee}
                  className="w-full py-2.5 border border-orange-400 text-orange-600 rounded-lg text-sm font-medium hover:bg-orange-50 transition-colors"
                >
                  {t("students.profile.actions.deleteLateFee")}
                </button>
                <button
                  type="button"
                  onClick={issueInvoice}
                  className="w-full py-2.5 border border-purple-500 text-purple-600 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors"
                >
                  {t("students.profile.actions.issueInvoice")}
                </button>
                {student?.isActive ? (
                  <button
                    type="button"
                    onClick={cancelStudent}
                    className="w-full py-2.5 border border-red-500 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
                  >
                    {t("students.profile.actions.cancel")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={reactivate}
                    className="w-full py-2.5 border border-emerald-500 text-emerald-600 rounded-lg text-sm font-medium hover:bg-emerald-50 transition-colors"
                  >
                    {t("students.profile.actions.reactivate")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>

        <InvoiceModal
          open={invoiceModalOpen}
          studentId={id}
          onClose={() => setInvoiceModalOpen(false)}
          onIssued={onInvoiceIssued}
        />

        {/* Invoices */}
        <div className="mt-5 bg-white rounded-xl shadow-md p-6">
          <h3 className="text-base font-bold text-[#1a2340] mb-4">{t("students.profile.invoices")}</h3>
          {invoices.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">{t("common.noData")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="py-2 text-right">#</th>
                  <th className="py-2 text-right">{t("invoices.issuedAt")}</th>
                  <th className="py-2 text-right">المبلغ</th>
                  <th className="py-2 text-right">الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => (
                  <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2">{formatDate(inv.createdAt)}</td>
                    <td className="py-2">{inv.amount.toLocaleString("ar-SA")} ر.س</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        {inv.pdfUrl && (
                          <>
                            <button
                              onClick={() => {
                                const base64 = inv.pdfUrl!.split(",")[1];
                                const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
                                const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
                                window.open(url, "_blank");
                              }}
                              className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                            >عرض</button>
                            <button
                              onClick={() => {
                                const link = document.createElement("a");
                                link.href = inv.pdfUrl!;
                                link.download = `فاتورة-${i + 1}.pdf`;
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                              }}
                              className="px-2.5 py-1 text-xs bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                            >تنزيل</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
