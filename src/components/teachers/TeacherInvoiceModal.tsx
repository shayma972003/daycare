"use client";

import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import axios from "axios";

interface TeacherLineItem {
  id: string;
  description: string;
  lateHours: number | "";
  price: number | "";
  isDeduction: boolean;
  protected: boolean;
}

interface PrefillData {
  school: {
    name: string;
    logoUrl: string | null;
    commercialRegistration: string | null;
    vatNumber: string | null;
    contactNumber: string | null;
    email: string | null;
    address: string | null;
  };
  teacher: {
    id: string;
    full_name: string;
    phone_1: string | null;
    email: string | null;
    payment_method: string;
    monthly_salary: number;
    late_deduction_rate: number;
    total_late_hours_this_month: number;
    class_name: string | null;
  };
  invoiceNumber: string;
  issueDate: string;
}

interface IssuedInvoice {
  id: string;
  amount: number;
  pdfUrl: string | null;
  createdAt: string;
}

interface TeacherInvoiceModalProps {
  open: boolean;
  teacherId: string;
  onClose: () => void;
  onIssued: (invoice: IssuedInvoice) => void;
}

const inputCls =
  "w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]";
const tdInput =
  "border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-[#F64651]";

function calcItemTotal(item: TeacherLineItem): number {
  const h = Number(item.lateHours);
  const p = Number(item.price);
  if (item.isDeduction) {
    return h && p ? -(h * p) : 0;
  }
  // For salary row: if no late hours, total = price
  if (!item.lateHours && item.lateHours !== 0) {
    return p || 0;
  }
  return h * p;
}

export function TeacherInvoiceModal({ open, teacherId, onClose, onIssued }: TeacherInvoiceModalProps) {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // School fields
  const [schoolName, setSchoolName] = useState("");
  const [commercialReg, setCommercialReg] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [address, setAddress] = useState("");

  // Invoice meta
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("مدفوع");

  // Teacher fields
  const [teacherName, setTeacherName] = useState("");
  const [className, setClassName] = useState("");
  const [teacherPhone, setTeacherPhone] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");

  // Line items (Row 1: salary, Row 2: deduction, then extras)
  const [lineItems, setLineItems] = useState<TeacherLineItem[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setDueDate("");
    setInvoiceStatus("مدفوع");

    axios
      .get<PrefillData>(`/api/invoices/prefill/teacher/${teacherId}`)
      .then((res) => {
        const d = res.data;
        setSchoolName(d.school.name ?? "");
        setCommercialReg(d.school.commercialRegistration ?? "");
        setVatNumber(d.school.vatNumber ?? "");
        setContactNumber(d.school.contactNumber ?? "");
        setSchoolEmail(d.school.email ?? "");
        setAddress(d.school.address ?? "");
        setInvoiceNumber(d.invoiceNumber);
        setIssuedAt(d.issueDate);
        setTeacherName(d.teacher.full_name ?? "");
        setClassName(d.teacher.class_name ?? "");
        setTeacherPhone(d.teacher.phone_1 ?? "");
        setTeacherEmail(d.teacher.email ?? "");
        setPaymentMethod(d.teacher.payment_method ?? "CASH");

        const salaryRow: TeacherLineItem = {
          id: "salary",
          description: "الراتب الشهري",
          lateHours: "",
          price: d.teacher.monthly_salary,
          isDeduction: false,
          protected: true,
        };
        const deductionRow: TeacherLineItem = {
          id: "deduction",
          description: "خصم التأخير",
          lateHours: d.teacher.total_late_hours_this_month,
          price: d.teacher.late_deduction_rate,
          isDeduction: true,
          protected: true,
        };
        setLineItems([salaryRow, deductionRow]);
      })
      .catch(() => setError("فشل تحميل البيانات"))
      .finally(() => setLoading(false));
  }, [open, teacherId]);

  function updateItem(id: string, field: keyof TeacherLineItem, value: unknown) {
    setLineItems((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addLineItem() {
    setLineItems((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        description: "",
        lateHours: 0,
        price: 0,
        isDeduction: false,
        protected: false,
      },
    ]);
  }

  function removeLineItem(id: string) {
    setLineItems((prev) => prev.filter((r) => r.id !== id));
  }

  const netSalary = lineItems.reduce((sum, item) => sum + calcItemTotal(item), 0);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await axios.post<IssuedInvoice>("/api/invoices/generate/teacher", {
        teacherId,
        invoiceData: {
          school: {
            name: schoolName,
            commercialRegistration: commercialReg || null,
            vatNumber: vatNumber || null,
            contactNumber: contactNumber || null,
            email: schoolEmail || null,
            address: address || null,
          },
          invoiceNumber,
          issuedAt,
          dueDate: dueDate || null,
          invoiceStatus,
          teacher: {
            full_name: teacherName,
            class_name: className || null,
            phone_1: teacherPhone || null,
            email: teacherEmail || null,
          },
          paymentMethod,
          lineItems: lineItems.map((item) => ({
            description: item.description,
            lateHours: item.lateHours === "" ? "" : Number(item.lateHours),
            price: Number(item.price) || 0,
            total: calcItemTotal(item),
          })),
          netSalary,
        },
      });

      onIssued({
        id: res.data.id,
        amount: res.data.amount,
        pdfUrl: res.data.pdfUrl,
        createdAt: res.data.createdAt,
      });
      onClose();
    } catch (err) {
      setError(
        axios.isAxiosError(err) ? err.response?.data?.error ?? "حدث خطأ" : "حدث خطأ"
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          dir="rtl"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-modal w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 focus:outline-none animate-scale-in"
        >
          <Dialog.Description className="sr-only">نافذة إصدار فاتورة للمعلم</Dialog.Description>

          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-lg font-bold text-[#111111]">إصدار فاتورة — معلم</Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
                ×
              </button>
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-7 h-7 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4 text-sm text-right">
                  {error}
                </div>
              )}

              {/* School info */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-[#111111] mb-3">بيانات الحضانة</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">اسم الحضانة</label>
                    <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">رقم السجل التجاري</label>
                    <input value={commercialReg} onChange={(e) => setCommercialReg(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">الرقم الضريبي VAT</label>
                    <input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">رقم التواصل</label>
                    <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">البريد الإلكتروني</label>
                    <input value={schoolEmail} onChange={(e) => setSchoolEmail(e.target.value)} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">العنوان</label>
                    <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
                  </div>
                </div>
              </div>

              {/* Invoice meta */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-[#111111] mb-3">بيانات الفاتورة</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">رقم الفاتورة</label>
                    <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">تاريخ الإصدار</label>
                    <input value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">تاريخ الاستحقاق</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className={inputCls}
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">حالة الفاتورة</label>
                    <select value={invoiceStatus} onChange={(e) => setInvoiceStatus(e.target.value)} className={inputCls}>
                      <option value="مدفوع">مدفوع</option>
                      <option value="متأخر">متأخر</option>
                      <option value="ملغي">ملغي</option>
                      <option value="موقف">موقف</option>
                      <option value="بانتظار الدفع">بانتظار الدفع</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Teacher info */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-[#111111] mb-3">بيانات المعلم</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">اسم المعلم</label>
                    <input value={teacherName} onChange={(e) => setTeacherName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">الصف</label>
                    <input value={className} onChange={(e) => setClassName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">رقم الجوال</label>
                    <input value={teacherPhone} onChange={(e) => setTeacherPhone(e.target.value)} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">البريد الإلكتروني</label>
                    <input value={teacherEmail} onChange={(e) => setTeacherEmail(e.target.value)} className={inputCls} dir="ltr" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 block mb-1">طريقة الدفع</label>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
                      <option value="CASH">نقدي</option>
                      <option value="TRANSFER">تحويل بنكي</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Line items table */}
              <div>
                <h3 className="text-sm font-bold text-[#111111] mb-3">تفاصيل الراتب</h3>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100 text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-right">الوصف</th>
                        <th className="px-3 py-2 text-right w-28">ساعات التأخير</th>
                        <th className="px-3 py-2 text-right w-24">السعر</th>
                        <th className="px-3 py-2 text-right w-28">الإجمالي</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item) => {
                        const total = calcItemTotal(item);
                        const isNeg = total < 0;
                        return (
                          <tr key={item.id} className="border-b border-gray-100">
                            <td className="px-2 py-1.5">
                              <input
                                value={item.description}
                                onChange={(e) => updateItem(item.id, "description", e.target.value)}
                                className={tdInput}
                                placeholder="الوصف"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              {item.id === "salary" ? (
                                <span className="text-xs text-gray-400 px-2">—</span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={item.lateHours}
                                  onChange={(e) =>
                                    updateItem(item.id, "lateHours", e.target.value === "" ? "" : Number(e.target.value))
                                  }
                                  className={tdInput}
                                />
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={item.price}
                                onChange={(e) =>
                                  updateItem(item.id, "price", e.target.value === "" ? "" : Number(e.target.value))
                                }
                                className={tdInput}
                              />
                            </td>
                            <td className={`px-3 py-1.5 text-sm font-medium ${isNeg ? "text-red-600" : "text-gray-700"}`}>
                              {total.toFixed(2)}
                            </td>
                            <td className="px-2 py-1.5">
                              {!item.protected && (
                                <button
                                  type="button"
                                  onClick={() => removeLineItem(item.id)}
                                  className="text-red-400 hover:text-red-600 text-lg font-bold leading-none"
                                >
                                  ×
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="px-3 py-2 flex items-center justify-between bg-gray-50">
                    <button
                      type="button"
                      onClick={addLineItem}
                      className="text-sm text-[#F64651] hover:underline font-medium"
                    >
                      + إضافة صف
                    </button>
                    <span className="text-sm font-bold text-[#111111]">
                      صافي الراتب: {netSalary.toFixed(2)} ر.س
                    </span>
                  </div>
                </div>
              </div>

              {/* Net salary summary */}
              <div className="flex justify-end">
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-6 py-3">
                  <span className="text-sm text-gray-500">صافي الراتب: </span>
                  <span className="text-lg font-bold text-coral">{netSalary.toFixed(2)} ر.س</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex-1 py-2.5 bg-[#F64651] text-white rounded-xl font-bold text-sm hover:bg-[#D93A44] transition-colors disabled:opacity-60"
                >
                  {generating ? "جاري الإصدار..." : "اصدر فاتورة"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 border border-red-300 text-red-600 rounded-xl text-sm hover:bg-red-50 transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
