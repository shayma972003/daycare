"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { teacherFormSchema } from "@/lib/form-schemas";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { formatDate, formatCurrency } from "@/lib/utils";
import { TeacherInvoiceModal } from "@/components/teachers/TeacherInvoiceModal";
import { useT } from "@/lib/i18n-provider";
import { astDayStart } from "@/lib/datetime";
import { EMPLOYMENT_STATUS_LABELS } from "@/lib/enum-labels";
import type { EmploymentStatus } from "@/generated/prisma/enums";

/** Every reason except "still employed", which is the reactivate action. */
type TeacherDepartureStatus = Exclude<EmploymentStatus, "ACTIVE">;
const DEPARTURE_OPTIONS: TeacherDepartureStatus[] = [
  "CONTRACT_ENDED",
  "RESIGNED",
  "TERMINATED",
];

interface ClassItem { id: string; name: string }
interface Invoice { id: string; createdAt: string; type: string; amount?: number | null; pdfUrl?: string | null }

interface Teacher {
  id: string; name: string;
  period?: "MORNING" | "EVENING" | null;
  classes?: ClassItem[];
  idNumber?: string | null; dateOfBirth?: string | null; nationality?: string | null;
  email?: string | null; phone1?: string | null; phone2?: string | null;
  paymentMethod?: "CASH" | "TRANSFER" | "CARD" | null;
  joinDate?: string | null; enrollmentEndDate?: string | null;
  monthlySalary?: number | null; lateDeductionRate?: number | null;
  qualification1?: string | null; qualification2?: string | null; qualification3?: string | null;
  qualification4?: string | null; qualification5?: string | null; qualification6?: string | null;
  qualification7?: string | null; qualification8?: string | null; qualification9?: string | null;
  qualification10?: string | null;
  attendanceHours?: number | null; lateHours?: number | null; isActive?: boolean;
  status?: EmploymentStatus | null; leftAt?: string | null; retentionUntil?: string | null;
  lateCountThisMonth?: number;
}

interface FormValues {
  name: string; period: "MORNING" | "EVENING" | ""; classId: string;
  idNumber: string; dateOfBirth: string; nationality: string;
  email: string; phone1: string; phone2: string;
  paymentMethod: "CASH" | "TRANSFER" | "";
  joinDate: string; enrollmentEndDate: string;
  monthlySalary: number; lateDeductionRate: number;
  qualification1: string; qualification2: string; qualification3: string;
}

const MAX_EXTRA = 7; // qualification4–10

export default function TeacherProfilePage() {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [trashClasses, setTrashClasses] = useState<{ id: string; name: string; group: string }[]>([]);
  const [trashing, setTrashing] = useState(false);
  const [showLateFeeConfirm, setShowLateFeeConfirm] = useState(false);

  // Ending the engagement (task D3.13). Defaults: contract ended, today —
  // the commonest case, and both are editable before confirming.
  const [showDepartureModal, setShowDepartureModal] = useState(false);
  const [departureStatus, setDepartureStatus] =
    useState<TeacherDepartureStatus>("CONTRACT_ENDED");
  // Today in Riyadh terms, in the `yyyy-mm-dd` an <input type="date"> expects —
  // matching the student screen, and never the host's UTC date.
  const [departureDate, setDepartureDate] = useState(() =>
    astDayStart().toISOString().slice(0, 10)
  );

  // Extra qualifications (4–10) stored as array of strings
  const [extraQuals, setExtraQuals] = useState<string[]>([]);

  // Same schema as the create form — see the note on the student profile.
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(teacherFormSchema) as Resolver<FormValues>,
    defaultValues: {
      name: "", period: "", classId: "", idNumber: "", dateOfBirth: "",
      nationality: "", email: "", phone1: "", phone2: "",
      paymentMethod: "", joinDate: "", enrollmentEndDate: "",
      monthlySalary: 0, lateDeductionRate: 0,
      qualification1: "", qualification2: "", qualification3: "",
    },
  });

  async function loadTeacher() {
    setLoading(true); setError(null);
    try {
      const [teacherRes, invoicesRes] = await Promise.all([
        axios.get<Teacher>(`/api/teachers/${id}`),
        axios.get<Invoice[]>(`/api/invoices?teacherId=${id}`),
      ]);
      const data = teacherRes.data;
      setTeacher(data);
      setInvoices(invoicesRes.data);
      reset({
        name: data.name ?? "", period: (data.period as "MORNING" | "EVENING") ?? "",
        classId: data.classes?.[0]?.id ?? "", idNumber: data.idNumber ?? "",
        dateOfBirth: data.dateOfBirth ? data.dateOfBirth.slice(0, 10) : "",
        nationality: data.nationality ?? "", email: data.email ?? "",
        phone1: data.phone1 ?? "", phone2: data.phone2 ?? "",
        paymentMethod: (data.paymentMethod === "CARD" ? "CASH" : (data.paymentMethod ?? "")) as "CASH" | "TRANSFER" | "",
        joinDate: data.joinDate ? data.joinDate.slice(0, 10) : "",
        enrollmentEndDate: data.enrollmentEndDate ? data.enrollmentEndDate.slice(0, 10) : "",
        monthlySalary: data.monthlySalary ?? 0, lateDeductionRate: data.lateDeductionRate ?? 0,
        qualification1: data.qualification1 ?? "",
        qualification2: data.qualification2 ?? "",
        qualification3: data.qualification3 ?? "",
      });
      // Load extra qualifications — only non-empty ones
      const extras: string[] = [];
      for (let i = 4; i <= 10; i++) {
        const v = data[`qualification${i}` as keyof Teacher] as string | null | undefined;
        if (v) extras.push(v);
      }
      setExtraQuals(extras);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (id) loadTeacher(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const watchedPeriod = watch("period");

  useEffect(() => {
    if (loading) return;
    axios
      .get<ClassItem[]>("/api/classes", { params: watchedPeriod ? { period: watchedPeriod } : {} })
      .then((r) => setClasses(r.data))
      .catch(() => {});
  }, [watchedPeriod, loading]);

  async function onSubmit(values: FormValues) {
    setSaving(true); setSaveError(null); setSaveSuccess(false);
    try {
      const extraPayload: Record<string, string | null> = {};
      for (let i = 4; i <= 10; i++) {
        const val = extraQuals[i - 4] || null;
        extraPayload[`qualification${i}`] = val;
      }
      await axios.put(`/api/teachers/${id}`, {
        name: values.name, period: values.period || null,
        idNumber: values.idNumber || null, dateOfBirth: values.dateOfBirth || null,
        nationality: values.nationality || null, email: values.email || null,
        phone1: values.phone1 || null, phone2: values.phone2 || null,
        paymentMethod: values.paymentMethod || null,
        joinDate: values.joinDate || null, enrollmentEndDate: values.enrollmentEndDate || null,
        monthlySalary: values.monthlySalary || null, lateDeductionRate: values.lateDeductionRate || null,
        qualification1: values.qualification1 || null,
        qualification2: values.qualification2 || null,
        qualification3: values.qualification3 || null,
        // The class select was registered and rendered, but its value was never
        // included in the payload — picking a class and saving did nothing.
        classId: values.classId || null,
        ...extraPayload,
      });
      setSaveSuccess(true);
      await loadTeacher();
    } catch { setSaveError(t("common.error")); }
    finally { setSaving(false); }
  }

  const [actionMessage, setActionMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleDeleteLateFee() {
    setActionLoading("lateFee");
    setActionMessage(null);
    try {
      await axios.delete(`/api/teachers/${id}/late-fee`);
      await loadTeacher();
      setActionMessage({ text: "تم حذف رسوم التأخير", ok: true });
    } catch (err) {
      // Was swallowed silently, so a failed delete looked identical to success.
      setActionMessage({ text: describeApiError(err, "تعذر حذف رسوم التأخير"), ok: false });
    } finally {
      setActionLoading(null);
    }
  }

  async function confirmDeleteLateFee() {
    setShowLateFeeConfirm(false);
    await handleDeleteLateFee();
  }

  /**
   * Ends the engagement (task D3.13).
   *
   * The reason and the date are asked for rather than assumed, matching the
   * student screen and for the same reason: `leftAt` starts the retention clock,
   * so a date defaulted to today for someone who left in March schedules the
   * erasure eight months late. "Resigned" versus "terminated" is also recorded
   * nowhere else.
   */
  async function confirmDeparture() {
    setActionLoading("cancel");
    setActionMessage(null);
    try {
      await axios.post(`/api/teachers/${id}/cancel`, {
        status: departureStatus,
        leftAt: new Date(departureDate).toISOString(),
      });
      setShowDepartureModal(false);
      await loadTeacher();
      setActionMessage({ text: "تم إنهاء الخدمة", ok: true });
    } catch (err) {
      setActionMessage({ text: describeApiError(err, "تعذر إنهاء الخدمة"), ok: false });
    } finally {
      setActionLoading(null);
    }
  }

  /** Puts an archived record back into service; clears `leftAt` and the expiry. */
  async function reactivate() {
    setActionLoading("cancel");
    setActionMessage(null);
    try {
      await axios.post(`/api/teachers/${id}/cancel`, { status: "ACTIVE" });
      await loadTeacher();
      setActionMessage({ text: "تمت إعادة التفعيل", ok: true });
    } catch (err) {
      setActionMessage({ text: describeApiError(err, "تعذرت إعادة التفعيل"), ok: false });
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * This used to be `alert("تم الإرسال")` with no request at all — staff were
   * told a notice had been sent when nothing had happened.
   */
  async function handleSendReminder() {
    setActionLoading("reminder");
    setActionMessage(null);
    try {
      const res = await axios.post<{ sentTo: string }>(`/api/teachers/${id}/reminder`);
      setActionMessage({ text: `تم الإرسال إلى ${res.data.sentTo}`, ok: true });
    } catch (err) {
      setActionMessage({ text: describeApiError(err, "تعذر إرسال الإشعار"), ok: false });
    } finally {
      setActionLoading(null);
    }
  }

  function onInvoiceIssued(inv: { id: string; amount: number; pdfUrl: string | null; createdAt: string }) {
    setInvoices((prev) => [{ ...inv, type: "TEACHER" }, ...prev]);
  }

  async function openTrashModal() {
    try {
      const res = await axios.get<{ assignedClasses: { id: string; name: string; group: string }[] }>(`/api/teachers/${id}/classes`);
      setTrashClasses(res.data.assignedClasses ?? []);
    } catch {
      setTrashClasses([]);
    }
    setShowTrashModal(true);
  }

  async function moveToTrash() {
    setTrashing(true);
    try {
      await axios.delete(`/api/teachers/${id}`);
      router.push("/teachers");
    } catch {
      alert(t("common.error"));
    } finally {
      setTrashing(false);
      setShowTrashModal(false);
    }
  }

  const inputCls = "w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm";
  const readonlyCls = "w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600 cursor-default";
  const selectCls = "w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm bg-white";
  const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

  const baseSalary = teacher?.monthlySalary ?? 0;
  const lateHrs = teacher?.lateHours ?? 0;
  const deductionRate = teacher?.lateDeductionRate ?? 0;
  const lateDeduction = lateHrs * deductionRate;
  const netSalary = baseSalary - lateDeduction;

  if (loading) return <div className="flex items-center justify-center min-h-screen text-gray-400 text-sm">{t("common.loading")}</div>;
  if (error || !teacher) return <div className="flex items-center justify-center min-h-screen text-red-500 text-sm">{error ?? t("common.error")}</div>;

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="h-16 bg-white border-b border-gray-100 flex items-center px-6 shadow-sm sticky top-0 z-30 gap-3">
        <button onClick={() => router.push("/teachers")} className="text-sm text-gray-500 hover:text-[#111111] transition-colors flex items-center gap-1.5">
          ← {t("teachers.title")}
        </button>
        <span className="text-gray-300">|</span>
        <h1 className="text-lg font-bold text-[#111111]">{teacher.name}</h1>
        {/* The reason and the last working day, not just "inactive" — the date
            is what the erasure schedule counts from, so it belongs on screen
            rather than only in the database. */}
        {!teacher.isActive && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            {teacher.status && teacher.status !== "ACTIVE"
              ? EMPLOYMENT_STATUS_LABELS[teacher.status]
              : "غير نشط"}
            {teacher.leftAt && ` · ${formatDate(teacher.leftAt)}`}
          </span>
        )}
      </div>

      <div className="flex-1 p-6">
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="flex gap-6 items-start">
            {/* Cards column */}
            <div className="flex-1 space-y-5">

              {/* ── بطاقة البيانات الشخصية ─────────────────────────── */}
              <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
                <h2 className="font-bold text-[#111111] text-base border-b border-gray-100 pb-3">البيانات الشخصية</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>الاسم الكامل</label>
                    <input {...register("name")} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>رقم الهوية / الإقامة</label>
                    <input {...register("idNumber")} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className={labelCls}>تاريخ الميلاد</label>
                    <input type="date" {...register("dateOfBirth")} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className={labelCls}>الجنسية</label>
                    <input {...register("nationality")} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>البريد الإلكتروني</label>
                    <input type="email" {...register("email")} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className={labelCls}>رقم الجوال 1</label>
                    <input {...register("phone1")} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className={labelCls}>رقم الجوال 2</label>
                    <input {...register("phone2")} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className={labelCls}>الفترة</label>
                    <select
                      {...register("period")}
                      className={selectCls}
                      onChange={(e) => {
                        register("period").onChange(e);
                        setValue("classId", "");
                      }}
                    >
                      <option value="">{t("common.select")}</option>
                      <option value="MORNING">صباحي</option>
                      <option value="EVENING">مسائي</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>الفصل</label>
                    <select {...register("classId")} className={selectCls}>
                      <option value="">{t("common.select")}</option>
                      {classes.map((cls) => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── بطاقة بيانات التوظيف ──────────────────────────── */}
              <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
                <h2 className="font-bold text-[#111111] text-base border-b border-gray-100 pb-3 flex items-center gap-2">
                  بيانات التوظيف
                  {(teacher?.lateCountThisMonth ?? 0) >= 5 && (
                    <div className="relative inline-block group">
                      <span className="text-yellow text-lg cursor-default">⚠</span>
                      <div className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap hidden group-hover:block z-10">
                        تأخير متكرر
                      </div>
                    </div>
                  )}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>تاريخ الانضمام</label>
                    <input type="date" {...register("joinDate")} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className={labelCls}>تاريخ انتهاء العقد</label>
                    <input type="date" {...register("enrollmentEndDate")} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className={labelCls}>خصم التأخير</label>
                    <div className="relative">
                      <input type="number" min={0} step="0.01" {...register("lateDeductionRate", { valueAsNumber: true })} className={inputCls} />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">ر.س/ساعة</span>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>الراتب الشهري</label>
                    <div className="relative">
                      <input type="number" min={0} {...register("monthlySalary", { valueAsNumber: true })} className={inputCls} />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">ر.س</span>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>طريقة الدفع</label>
                    <select {...register("paymentMethod")} className={selectCls}>
                      <option value="">{t("common.select")}</option>
                      <option value="CASH">نقدي</option>
                      <option value="TRANSFER">تحويل</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* ── بطاقة المؤهلات الوظيفية ────────────────────────── */}
              <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
                <h2 className="font-bold text-[#111111] text-base border-b border-gray-100 pb-3">المؤهلات الوظيفية</h2>
                <div className="space-y-3">
                  {([1, 2, 3] as const).map((n) => (
                    <div key={n}>
                      <label className={labelCls}>المؤهل {n}</label>
                      <input {...register(`qualification${n}` as "qualification1" | "qualification2" | "qualification3")} className={inputCls} />
                    </div>
                  ))}

                  {extraQuals.map((val, idx) => (
                    <div key={idx + 4}>
                      <label className={labelCls}>المؤهل {idx + 4}</label>
                      <input
                        value={val}
                        onChange={(e) => setExtraQuals((prev) => { const next = [...prev]; next[idx] = e.target.value; return next; })}
                        className={inputCls}
                      />
                    </div>
                  ))}

                  {extraQuals.length < MAX_EXTRA && (
                    <button
                      type="button"
                      onClick={() => setExtraQuals((prev) => [...prev, ""])}
                      className="text-sm text-[#F64651] hover:underline font-medium"
                    >
                      + إضافة مؤهل
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100 mt-2">
                  <div>
                    <label className={labelCls}>ساعات الحضور</label>
                    <div className={readonlyCls}>{teacher.attendanceHours ?? 0} {t("common.hours")}</div>
                  </div>
                  <div>
                    <label className={labelCls}>ساعات التأخير</label>
                    <div className={readonlyCls}>{teacher.lateHours ?? 0} {t("common.hours")}</div>
                  </div>
                </div>
              </div>

              {/* Feedback */}
              {saveError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{saveError}</div>}
              {saveSuccess && <div className="p-3 bg-success-bg border border-success-text/20 rounded-xl text-sm text-success-text">{t("common.success")}</div>}
              {actionMessage && (
                <div
                  role="alert"
                  className={`p-3 rounded-xl text-sm border ${
                    actionMessage.ok
                      ? "bg-success-bg border-success-text/20 text-success-text"
                      : "bg-red-50 border-red-200 text-red-700"
                  }`}
                >
                  {actionMessage.text}
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="w-72 space-y-4 shrink-0">
              <div className="bg-white rounded-xl shadow-md p-4">
                <div className="flex flex-col gap-3 w-full">
                  {/* 1. حفظ التغييرات */}
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full px-5 py-2.5 rounded-md bg-coral text-white font-medium text-sm
                               hover:bg-coral-dark active:scale-[0.98] transition-all disabled:opacity-60"
                  >
                    {saving ? t("common.loading") : t("teachers.profile.actions.save")}
                  </button>

                  {/* 2. ارسال تذكير بالدفع */}
                  <button
                    type="button"
                    onClick={handleSendReminder}
                    className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                               border border-[#666666] text-[#666666]
                               hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA]
                               active:scale-[0.98] transition-all"
                  >
                    ارسال تذكير بالدفع
                  </button>

                  {/* 3. إصدار فاتورة */}
                  <button
                    type="button"
                    onClick={() => setInvoiceModalOpen(true)}
                    className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                               border border-[#666666] text-[#666666]
                               hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA]
                               active:scale-[0.98] transition-all"
                  >
                    {t("teachers.profile.actions.issueInvoice")}
                  </button>

                  {/* 4. إنهاء الخدمة — أو إعادة التفعيل لمن أُنهيت خدمته */}
                  <button
                    type="button"
                    onClick={() =>
                      teacher.isActive === false ? reactivate() : setShowDepartureModal(true)
                    }
                    disabled={actionLoading === "cancel"}
                    className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                               border border-[#666666] text-[#666666]
                               hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA]
                               active:scale-[0.98] transition-all disabled:opacity-60"
                  >
                    {actionLoading === "cancel"
                      ? t("common.loading")
                      : teacher.isActive === false
                        ? "إعادة التفعيل"
                        : "إنهاء الخدمة"}
                  </button>

                  {/* 5. حذف رسوم التأخير */}
                  <button
                    type="button"
                    onClick={() => setShowLateFeeConfirm(true)}
                    disabled={actionLoading === "lateFee"}
                    className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                               border border-[#666666] text-[#666666]
                               hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA]
                               active:scale-[0.98] transition-all disabled:opacity-60"
                  >
                    {actionLoading === "lateFee" ? t("common.loading") : t("teachers.profile.actions.deleteLateFee")}
                  </button>

                  {/* 6. نقل إلى سلة المحذوفات */}
                  <button
                    type="button"
                    onClick={openTrashModal}
                    className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                               border border-[#666666] text-[#666666]
                               hover:border-[#F64651] hover:text-[#F64651] hover:bg-[#FFE8EA]
                               active:scale-[0.98] transition-all"
                  >
                    نقل إلى سلة المحذوفات
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
                <h3 className="font-bold text-[#111111] text-sm">{t("teachers.profile.salaryCalc.title")}</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <span className="text-gray-500">{t("teachers.profile.salaryCalc.baseSalary")}</span>
                    <span className="font-medium text-[#111111]">{formatCurrency(baseSalary)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <span className="text-gray-500">{t("teachers.profile.salaryCalc.lateDeduction")}</span>
                    <span className="font-medium text-red-600">- {formatCurrency(lateDeduction)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 bg-gray-50 rounded-lg px-2">
                    <span className="font-bold text-[#111111]">{t("teachers.profile.salaryCalc.netSalary")}</span>
                    <span className="font-bold text-[#F64651] text-base">{formatCurrency(netSalary)}</span>
                  </div>
                  <p className="text-xs text-gray-400 text-center pt-1">{lateHrs} {t("common.hours")} × {formatCurrency(deductionRate)} = {formatCurrency(lateDeduction)}</p>
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* ── بطاقة الفواتير المصدرة ─────────────────────────────── */}
        <div className="mt-6 bg-white rounded-xl shadow-md overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-bold text-[#111111] text-base">{t("teachers.profile.invoices")}</h2>
          </div>
          {invoices.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-gray-400 text-sm">{t("common.noData")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-6 py-3 text-right font-medium text-gray-600">الفاتورة</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-600">صافي الراتب</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-600">تاريخ الإصدار</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-600">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50/50">
                    <td className="px-6 py-3 text-gray-700">{t("invoices.teacherInvoice")} #{inv.id.slice(0, 8)}</td>
                    <td className="px-6 py-3 text-gray-500">{inv.amount != null ? `${Number(inv.amount).toFixed(2)} ر.س` : "—"}</td>
                    <td className="px-6 py-3 text-gray-500">{formatDate(inv.createdAt)}</td>
                    <td className="px-6 py-3">
                      <div className="flex gap-2">
                        {inv.pdfUrl && (
                          <>
                            <button onClick={() => { const b64 = inv.pdfUrl!.split(",")[1]; const bytes = Uint8Array.from(atob(b64),(c)=>c.charCodeAt(0)); window.open(URL.createObjectURL(new Blob([bytes],{type:"application/pdf"})),"_blank"); }} className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100">عرض</button>
                            <button onClick={() => { const a=document.createElement("a"); a.href=inv.pdfUrl!; a.download=`فاتورة-${inv.id.slice(0,8)}.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a); }} className="px-2.5 py-1 text-xs bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100">تنزيل</button>
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

      <TeacherInvoiceModal open={invoiceModalOpen} teacherId={id} onClose={() => setInvoiceModalOpen(false)} onIssued={onInvoiceIssued} />

      {showDepartureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 space-y-4" dir="rtl">
            <p className="text-base font-bold text-[#111111] text-center">إنهاء خدمة الموظف</p>

            <div>
              <label className="block text-sm text-gray-600 mb-1">سبب الإنهاء</label>
              <select
                value={departureStatus}
                onChange={(e) => setDepartureStatus(e.target.value as TeacherDepartureStatus)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
              >
                {DEPARTURE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {EMPLOYMENT_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">تاريخ آخر يوم عمل</label>
              <input
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            {/* Stated up front: this date is what the erasure schedule counts
                from, and it is not obvious from a form labelled "end service". */}
            <p className="text-xs text-gray-500 leading-relaxed">
              تُحفظ بيانات الموظف الشخصية لمدة الاحتفاظ المعتمدة ابتداءً من هذا التاريخ، ثم تُزال
              تلقائياً مع بقاء سجل الرواتب والإحصاءات كاملاً.
            </p>

            <div className="flex gap-3 justify-center pt-1">
              <button
                onClick={confirmDeparture}
                disabled={actionLoading === "cancel" || !departureDate}
                className="px-5 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e] disabled:opacity-60"
              >
                {actionLoading === "cancel" ? "..." : "تأكيد"}
              </button>
              <button
                onClick={() => setShowDepartureModal(false)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {showTrashModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            {trashClasses.length === 0 ? (
              <>
                <p className="text-base font-bold text-[#111111]">نقل إلى سلة المحذوفات؟</p>
                <p className="text-sm text-gray-600 whitespace-pre-line">
                  {`سيتم نقل ملف ${teacher?.name ?? ""} إلى سلة المحذوفات.\nيمكنك استعادته خلال 30 يوماً.`}
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-bold text-[#111111] text-right">هذا المعلم هو المعلم المسؤول على:</p>
                <ul className="text-sm text-gray-700 text-right space-y-1 max-h-40 overflow-y-auto">
                  {trashClasses.map((c) => (
                    <li key={c.id}>- {c.name} ({c.group})</li>
                  ))}
                </ul>
                <p className="text-sm text-gray-600 whitespace-pre-line text-right">
                  {"عند الحذف ستبقى هذه الفصول بدون معلم مسؤول\nوسيظهر تنبيه عليها حتى يتم التعيين."}
                </p>
              </>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={moveToTrash}
                disabled={trashing}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {trashing ? "..." : trashClasses.length === 0 ? "تأكيد النقل" : "حذف"}
              </button>
              <button
                onClick={() => setShowTrashModal(false)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {showLateFeeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            <p className="text-base font-bold text-[#111111]">حذف رسوم التأخير؟</p>
            <p className="text-sm text-gray-600">هل أنت متأكد من حذف رسوم التأخير لهذا المعلم؟</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={confirmDeleteLateFee}
                disabled={actionLoading === "lateFee"}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {actionLoading === "lateFee" ? "..." : "حذف"}
              </button>
              <button
                onClick={() => setShowLateFeeConfirm(false)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
