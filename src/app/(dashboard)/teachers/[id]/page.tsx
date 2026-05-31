"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import axios from "axios";
import { t, formatDate, formatCurrency } from "@/lib/utils";
import { TeacherInvoiceModal } from "@/components/teachers/TeacherInvoiceModal";

interface ClassItem {
  id: string;
  name: string;
}

interface Invoice {
  id: string;
  createdAt: string;
  type: string;
  amount?: number | null;
  pdfUrl?: string | null;
}

interface Teacher {
  id: string;
  name: string;
  period?: "MORNING" | "EVENING" | null;
  classId?: string | null;
  classes?: ClassItem[];
  idNumber?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  email?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  paymentMethod?: "CASH" | "TRANSFER" | "CARD" | null;
  joinDate?: string | null;
  enrollmentEndDate?: string | null;
  monthlySalary?: number | null;
  lateDeductionRate?: number | null;
  qualification1?: string | null;
  qualification2?: string | null;
  qualification3?: string | null;
  attendanceHours?: number | null;
  lateHours?: number | null;
  isActive?: boolean;
}

interface FormValues {
  name: string;
  period: "MORNING" | "EVENING" | "";
  classId: string;
  idNumber: string;
  dateOfBirth: string;
  nationality: string;
  email: string;
  phone1: string;
  phone2: string;
  paymentMethod: "CASH" | "TRANSFER" | "CARD" | "";
  joinDate: string;
  enrollmentEndDate: string;
  monthlySalary: number;
  lateDeductionRate: number;
  qualification1: string;
  qualification2: string;
  qualification3: string;
}

export default function TeacherProfilePage() {
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

  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: {
      name: "",
      period: "",
      classId: "",
      idNumber: "",
      dateOfBirth: "",
      nationality: "",
      email: "",
      phone1: "",
      phone2: "",
      paymentMethod: "",
      joinDate: "",
      enrollmentEndDate: "",
      monthlySalary: 0,
      lateDeductionRate: 0,
      qualification1: "",
      qualification2: "",
      qualification3: "",
    },
  });

  async function loadTeacher() {
    setLoading(true);
    setError(null);
    try {
      const [teacherRes, classesRes, invoicesRes] = await Promise.all([
        axios.get<Teacher>(`/api/teachers/${id}`),
        axios.get<ClassItem[]>("/api/classes"),
        axios.get<Invoice[]>(`/api/invoices?teacherId=${id}`),
      ]);
      const data = teacherRes.data;
      setTeacher(data);
      setClasses(classesRes.data);
      setInvoices(invoicesRes.data);
      reset({
        name: data.name ?? "",
        period: (data.period as "MORNING" | "EVENING") ?? "",
        classId: data.classes?.[0]?.id ?? "",
        idNumber: data.idNumber ?? "",
        dateOfBirth: data.dateOfBirth ? data.dateOfBirth.slice(0, 10) : "",
        nationality: data.nationality ?? "",
        email: data.email ?? "",
        phone1: data.phone1 ?? "",
        phone2: data.phone2 ?? "",
        paymentMethod: (data.paymentMethod as "CASH" | "TRANSFER" | "CARD") ?? "",
        joinDate: data.joinDate ? data.joinDate.slice(0, 10) : "",
        enrollmentEndDate: data.enrollmentEndDate
          ? data.enrollmentEndDate.slice(0, 10)
          : "",
        monthlySalary: data.monthlySalary ?? 0,
        lateDeductionRate: data.lateDeductionRate ?? 0,
        qualification1: data.qualification1 ?? "",
        qualification2: data.qualification2 ?? "",
        qualification3: data.qualification3 ?? "",
      });
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) loadTeacher();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: FormValues) {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await axios.put(`/api/teachers/${id}`, {
        name: values.name,
        period: values.period || null,
        idNumber: values.idNumber || null,
        dateOfBirth: values.dateOfBirth || null,
        nationality: values.nationality || null,
        email: values.email || null,
        phone1: values.phone1 || null,
        phone2: values.phone2 || null,
        paymentMethod: values.paymentMethod || null,
        joinDate: values.joinDate || null,
        enrollmentEndDate: values.enrollmentEndDate || null,
        monthlySalary: values.monthlySalary || null,
        lateDeductionRate: values.lateDeductionRate || null,
        qualification1: values.qualification1 || null,
        qualification2: values.qualification2 || null,
        qualification3: values.qualification3 || null,
      });
      setSaveSuccess(true);
      await loadTeacher();
    } catch {
      setSaveError(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLateFee() {
    setActionLoading("lateFee");
    try {
      await axios.delete(`/api/teachers/${id}/late-fee`);
      await loadTeacher();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  }

  function handleIssueInvoice() {
    setInvoiceModalOpen(true);
  }

  function onInvoiceIssued(invoice: { id: string; amount: number; pdfUrl: string | null; createdAt: string }) {
    setInvoices((prev) => [{ ...invoice, type: "TEACHER" }, ...prev]);
  }

  async function handleCancel() {
    setActionLoading("cancel");
    try {
      await axios.post(`/api/teachers/${id}/cancel`);
      await loadTeacher();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  }

  const inputCls =
    "w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm";
  const readonlyCls =
    "w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600 cursor-default";
  const selectCls =
    "w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm bg-white";
  const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

  // Salary calculation
  const baseSalary = teacher?.monthlySalary ?? 0;
  const lateHours = teacher?.lateHours ?? 0;
  const deductionRate = teacher?.lateDeductionRate ?? 0;
  const lateDeduction = lateHours * deductionRate;
  const netSalary = baseSalary - lateDeduction;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400 text-sm">
        {t("common.loading")}
      </div>
    );
  }

  if (error || !teacher) {
    return (
      <div className="flex items-center justify-center min-h-screen text-red-500 text-sm">
        {error ?? t("common.error")}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="h-16 bg-white border-b border-gray-100 flex items-center px-6 shadow-sm sticky top-0 z-30 gap-3">
        <button
          onClick={() => router.push("/teachers")}
          className="text-sm text-gray-500 hover:text-[#1a2340] transition-colors flex items-center gap-1.5"
        >
          ← {t("teachers.title")}
        </button>
        <span className="text-gray-300">|</span>
        <h1 className="text-lg font-bold text-[#1a2340]">{teacher.name}</h1>
        {!teacher.isActive && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            غير نشط
          </span>
        )}
      </div>

      <div className="flex-1 p-6">
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="flex gap-6 items-start">
            {/* Left: Form fields */}
            <div className="flex-1 space-y-4">
              <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
                <h2 className="font-bold text-[#1a2340] text-base border-b border-gray-100 pb-3">
                  {t("teachers.profile.title")}
                </h2>

                {/* Name */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.name")}</label>
                  <input {...register("name")} className={inputCls} />
                </div>

                {/* Period */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.period")}</label>
                  <select {...register("period")} className={selectCls}>
                    <option value="">{t("common.select")}</option>
                    <option value="MORNING">{t("periods.MORNING")}</option>
                    <option value="EVENING">{t("periods.EVENING")}</option>
                  </select>
                </div>

                {/* Class */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.class")}</label>
                  <select {...register("classId")} className={selectCls}>
                    <option value="">{t("common.select")}</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* ID Number */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.idNumber")}</label>
                  <input {...register("idNumber")} className={inputCls} dir="ltr" />
                </div>

                {/* Date of Birth */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.dateOfBirth")}</label>
                  <input
                    type="date"
                    {...register("dateOfBirth")}
                    className={inputCls}
                    dir="ltr"
                  />
                </div>

                {/* Nationality */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.nationality")}</label>
                  <input {...register("nationality")} className={inputCls} />
                </div>

                {/* Email */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.email")}</label>
                  <input
                    type="email"
                    {...register("email")}
                    className={inputCls}
                    dir="ltr"
                  />
                </div>

                {/* Phone 1 */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.phone1")}</label>
                  <input {...register("phone1")} className={inputCls} dir="ltr" />
                </div>

                {/* Phone 2 */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.phone2")}</label>
                  <input {...register("phone2")} className={inputCls} dir="ltr" />
                </div>

                {/* Payment Method */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.paymentMethod")}</label>
                  <select {...register("paymentMethod")} className={selectCls}>
                    <option value="">{t("common.select")}</option>
                    <option value="CASH">{t("paymentMethod.CASH")}</option>
                    <option value="TRANSFER">{t("paymentMethod.TRANSFER")}</option>
                    <option value="CARD">{t("paymentMethod.CARD")}</option>
                  </select>
                </div>

                {/* Join Date */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.joinDate")}</label>
                  <input
                    type="date"
                    {...register("joinDate")}
                    className={inputCls}
                    dir="ltr"
                  />
                </div>

                {/* Enrollment End Date */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.enrollmentEndDate")}</label>
                  <input
                    type="date"
                    {...register("enrollmentEndDate")}
                    className={inputCls}
                    dir="ltr"
                  />
                </div>

                {/* Monthly Salary */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.monthlySalary")}</label>
                  <input
                    type="number"
                    min={0}
                    {...register("monthlySalary", { valueAsNumber: true })}
                    className={inputCls}
                  />
                </div>

                {/* Late Deduction Rate */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.lateDeductionRate")}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    {...register("lateDeductionRate", { valueAsNumber: true })}
                    className={inputCls}
                  />
                </div>

                {/* Qualifications */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.qualification1")}</label>
                  <input {...register("qualification1")} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("teachers.profile.qualification2")}</label>
                  <input {...register("qualification2")} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("teachers.profile.qualification3")}</label>
                  <input {...register("qualification3")} className={inputCls} />
                </div>

                {/* Attendance Hours (read-only) */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.attendanceHours")}</label>
                  <div className={readonlyCls}>
                    {teacher.attendanceHours ?? 0} {t("common.hours")}
                  </div>
                </div>

                {/* Late Hours (read-only) */}
                <div>
                  <label className={labelCls}>{t("teachers.profile.lateHours")}</label>
                  <div className={readonlyCls}>
                    {teacher.lateHours ?? 0} {t("common.hours")}
                  </div>
                </div>
              </div>

              {/* Feedback */}
              {saveError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {saveError}
                </div>
              )}
              {saveSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
                  {t("common.success")}
                </div>
              )}
            </div>

            {/* Right: Actions sidebar */}
            <div className="w-72 space-y-4 shrink-0">
              {/* Save button */}
              <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2.5 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60"
                >
                  {saving ? t("common.loading") : t("teachers.profile.actions.save")}
                </button>

                <button
                  type="button"
                  onClick={handleDeleteLateFee}
                  disabled={actionLoading === "lateFee"}
                  className="w-full py-2.5 border border-orange-400 text-orange-600 rounded-xl text-sm font-medium hover:bg-orange-50 transition-all disabled:opacity-60"
                >
                  {actionLoading === "lateFee"
                    ? t("common.loading")
                    : t("teachers.profile.actions.deleteLateFee")}
                </button>

                <button
                  type="button"
                  onClick={handleIssueInvoice}
                  disabled={actionLoading === "invoice"}
                  className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-60"
                >
                  {actionLoading === "invoice"
                    ? t("common.loading")
                    : t("teachers.profile.actions.issueInvoice")}
                </button>

                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={actionLoading === "cancel"}
                  className="w-full py-2.5 border border-red-500 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-all disabled:opacity-60"
                >
                  {actionLoading === "cancel"
                    ? t("common.loading")
                    : t("teachers.profile.actions.cancel")}
                </button>
              </div>

              {/* Salary calculation card */}
              <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
                <h3 className="font-bold text-[#1a2340] text-sm">
                  {t("teachers.profile.salaryCalc.title")}
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <span className="text-gray-500">
                      {t("teachers.profile.salaryCalc.baseSalary")}
                    </span>
                    <span className="font-medium text-[#1a2340]">
                      {formatCurrency(baseSalary)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <span className="text-gray-500">
                      {t("teachers.profile.salaryCalc.lateDeduction")}
                    </span>
                    <span className="font-medium text-red-600">
                      - {formatCurrency(lateDeduction)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 bg-gray-50 rounded-lg px-2">
                    <span className="font-bold text-[#1a2340]">
                      {t("teachers.profile.salaryCalc.netSalary")}
                    </span>
                    <span className="font-bold text-[#22c55e] text-base">
                      {formatCurrency(netSalary)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 text-center pt-1">
                    {lateHours} {t("common.hours")} × {formatCurrency(deductionRate)} = {formatCurrency(lateDeduction)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Invoices table */}
        <div className="mt-6 bg-white rounded-xl shadow-md overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-bold text-[#1a2340] text-base">
              {t("teachers.profile.invoices")}
            </h2>
          </div>
          {invoices.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
              {t("common.noData")}
            </div>
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
                    <td className="px-6 py-3 text-gray-700">
                      {t("invoices.teacherInvoice")} #{inv.id.slice(0, 8)}
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {inv.amount != null ? `${Number(inv.amount).toFixed(2)} ر.س` : "—"}
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {formatDate(inv.createdAt)}
                    </td>
                    <td className="px-6 py-3">
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
                                link.download = `فاتورة-${inv.id.slice(0, 8)}.pdf`;
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

      <TeacherInvoiceModal
        open={invoiceModalOpen}
        teacherId={id}
        onClose={() => setInvoiceModalOpen(false)}
        onIssued={onInvoiceIssued}
      />
    </div>
  );
}
