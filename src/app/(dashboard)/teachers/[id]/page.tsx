"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import axios from "axios";
import { t, formatDate, formatCurrency } from "@/lib/utils";
import { TeacherInvoiceModal } from "@/components/teachers/TeacherInvoiceModal";

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

  // Extra qualifications (4–10) stored as array of strings
  const [extraQuals, setExtraQuals] = useState<string[]>([]);

  const { register, handleSubmit, reset } = useForm<FormValues>({
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
        ...extraPayload,
      });
      setSaveSuccess(true);
      await loadTeacher();
    } catch { setSaveError(t("common.error")); }
    finally { setSaving(false); }
  }

  async function handleDeleteLateFee() {
    setActionLoading("lateFee");
    try { await axios.delete(`/api/teachers/${id}/late-fee`); await loadTeacher(); }
    catch { /* silent */ } finally { setActionLoading(null); }
  }

  async function handleCancel() {
    setActionLoading("cancel");
    try { await axios.post(`/api/teachers/${id}/cancel`); await loadTeacher(); }
    catch { /* silent */ } finally { setActionLoading(null); }
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

  const inputCls = "w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm";
  const readonlyCls = "w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600 cursor-default";
  const selectCls = "w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm bg-white";
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
        <button onClick={() => router.push("/teachers")} className="text-sm text-gray-500 hover:text-[#1a2340] transition-colors flex items-center gap-1.5">
          ← {t("teachers.title")}
        </button>
        <span className="text-gray-300">|</span>
        <h1 className="text-lg font-bold text-[#1a2340]">{teacher.name}</h1>
        {!teacher.isActive && <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">غير نشط</span>}
      </div>

      <div className="flex-1 p-6">
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="flex gap-6 items-start">
            {/* Cards column */}
            <div className="flex-1 space-y-5">

              {/* ── بطاقة البيانات الشخصية ─────────────────────────── */}
              <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
                <h2 className="font-bold text-[#1a2340] text-base border-b border-gray-100 pb-3">البيانات الشخصية</h2>
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
                    <select {...register("period")} className={selectCls}>
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
                <h2 className="font-bold text-[#1a2340] text-base border-b border-gray-100 pb-3">بيانات التوظيف</h2>
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
                <h2 className="font-bold text-[#1a2340] text-base border-b border-gray-100 pb-3">المؤهلات الوظيفية</h2>
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
                      className="text-sm text-[#22c55e] hover:underline font-medium"
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
              {saveSuccess && <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">{t("common.success")}</div>}
            </div>

            {/* Sidebar */}
            <div className="w-72 space-y-4 shrink-0">
              <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
                <button type="submit" disabled={saving} className="w-full py-2.5 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60">
                  {saving ? t("common.loading") : t("teachers.profile.actions.save")}
                </button>
                <button type="button" onClick={() => setInvoiceModalOpen(true)} className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium transition-all">
                  {t("teachers.profile.actions.issueInvoice")}
                </button>
                <button type="button" onClick={handleDeleteLateFee} disabled={actionLoading === "lateFee"} className="w-full py-2.5 border border-orange-400 text-orange-600 rounded-xl text-sm font-medium hover:bg-orange-50 transition-all disabled:opacity-60">
                  {actionLoading === "lateFee" ? t("common.loading") : t("teachers.profile.actions.deleteLateFee")}
                </button>
                <button type="button" onClick={handleCancel} disabled={actionLoading === "cancel"} className="w-full py-2.5 border border-red-500 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-all disabled:opacity-60">
                  {actionLoading === "cancel" ? t("common.loading") : t("teachers.profile.actions.cancel")}
                </button>
                <button type="button" onClick={openTrashModal} className="w-full py-2.5 border border-red-500 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-all">
                  نقل إلى سلة المحذوفات
                </button>
              </div>

              <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
                <h3 className="font-bold text-[#1a2340] text-sm">{t("teachers.profile.salaryCalc.title")}</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <span className="text-gray-500">{t("teachers.profile.salaryCalc.baseSalary")}</span>
                    <span className="font-medium text-[#1a2340]">{formatCurrency(baseSalary)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <span className="text-gray-500">{t("teachers.profile.salaryCalc.lateDeduction")}</span>
                    <span className="font-medium text-red-600">- {formatCurrency(lateDeduction)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 bg-gray-50 rounded-lg px-2">
                    <span className="font-bold text-[#1a2340]">{t("teachers.profile.salaryCalc.netSalary")}</span>
                    <span className="font-bold text-[#22c55e] text-base">{formatCurrency(netSalary)}</span>
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
            <h2 className="font-bold text-[#1a2340] text-base">{t("teachers.profile.invoices")}</h2>
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

      {showTrashModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            {trashClasses.length === 0 ? (
              <>
                <p className="text-base font-bold text-[#1a2340]">نقل إلى سلة المحذوفات؟</p>
                <p className="text-sm text-gray-600 whitespace-pre-line">
                  {`سيتم نقل ملف ${teacher?.name ?? ""} إلى سلة المحذوفات.\nيمكنك استعادته خلال 30 يوماً.`}
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-bold text-[#1a2340] text-right">هذا المعلم هو المعلم المسؤول على:</p>
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
    </div>
  );
}
