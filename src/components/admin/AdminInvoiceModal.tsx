"use client";

import { useEffect, useState } from "react";
import axios from "axios";

interface LineItem {
  id: string;
  description: string;
  quantity: number | "";
  price: number | "";
  vat: number | "";
}

interface PrefillData {
  invoiceNumber: string;
  schoolName: string;
  schoolCommercialReg: string;
  schoolVatNumber: string;
  schoolContact: string;
  schoolEmail: string;
  schoolAddress: string;
  planName: string;
  planPrice: number;
  ourCompanyName: string;
  ourCommercialReg: string;
  ourVatNumber: string;
  ourContactNumber: string;
  ourEmail: string;
  ourAddress: string;
  suggestedLineItem: { description: string; quantity: number; price: number; vat: number; total: number };
}

interface IssuedInvoice {
  invoice_id: string;
  file_url: string;
}

interface AdminInvoiceModalProps {
  open: boolean;
  schoolId: string;
  onClose: () => void;
  onIssued: (invoice: IssuedInvoice) => void;
}

const STATUS_OPTIONS = ["مدفوع", "متأخر", "ملغي", "بانتظار الدفع"];

function calcRowTotal(price: number | "", vat: number | "") {
  return (Number(price) || 0) + (Number(vat) || 0);
}

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function AdminInvoiceModal({ open, schoolId, onClose, onIssued }: AdminInvoiceModalProps) {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ourCompanyName, setOurCompanyName] = useState("");
  const [ourCommercialReg, setOurCommercialReg] = useState("");
  const [ourVatNumber, setOurVatNumber] = useState("");
  const [ourContactNumber, setOurContactNumber] = useState("");
  const [ourEmail, setOurEmail] = useState("");
  const [ourAddress, setOurAddress] = useState("");

  const [schoolName, setSchoolName] = useState("");
  const [schoolCommercialReg, setSchoolCommercialReg] = useState("");
  const [schoolVatNumber, setSchoolVatNumber] = useState("");
  const [schoolContact, setSchoolContact] = useState("");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [schoolAddress, setSchoolAddress] = useState("");

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [subscriptionType, setSubscriptionType] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState("متأخر");
  const [paymentMethod, setPaymentMethod] = useState("");

  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    axios
      .get<PrefillData>(`/api/admin/invoices/prefill/${schoolId}`)
      .then((res) => {
        const d = res.data;
        setOurCompanyName(d.ourCompanyName);
        setOurCommercialReg(d.ourCommercialReg);
        setOurVatNumber(d.ourVatNumber);
        setOurContactNumber(d.ourContactNumber);
        setOurEmail(d.ourEmail);
        setOurAddress(d.ourAddress);

        setSchoolName(d.schoolName);
        setSchoolCommercialReg(d.schoolCommercialReg);
        setSchoolVatNumber(d.schoolVatNumber);
        setSchoolContact(d.schoolContact);
        setSchoolEmail(d.schoolEmail);
        setSchoolAddress(d.schoolAddress);

        setInvoiceNumber(d.invoiceNumber);
        setSubscriptionType(d.planName);
        setIssueDate(toDateInput(new Date()));
        setDueDate("");
        setStatus("متأخر");
        setPaymentMethod("");

        setLineItems([
          {
            id: "1",
            description: d.suggestedLineItem.description,
            quantity: d.suggestedLineItem.quantity,
            price: d.suggestedLineItem.price,
            vat: d.suggestedLineItem.vat,
          },
        ]);
      })
      .catch(() => setError("فشل تحميل البيانات"))
      .finally(() => setLoading(false));
  }, [open, schoolId]);

  function addLineItem() {
    setLineItems((prev) => [...prev, { id: Date.now().toString(), description: "", quantity: 1, price: 0, vat: 0 }]);
  }

  function removeLineItem(id: string) {
    setLineItems((prev) => prev.filter((r) => r.id !== id));
  }

  function updateLineItem(id: string, field: keyof LineItem, value: string | number) {
    setLineItems((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        // Auto-calc VAT (15%) whenever price changes, unless the user is editing VAT itself
        if (field === "price") {
          updated.vat = Number(value) ? Number(value) * 0.15 : 0;
        }
        return updated;
      })
    );
  }

  const grandTotal = lineItems.reduce((sum, r) => sum + calcRowTotal(r.price, r.vat), 0);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await axios.post<IssuedInvoice>("/api/admin/invoices/generate", {
        school_id: schoolId,
        subscription_type: subscriptionType || null,
        issue_date: issueDate,
        due_date: dueDate || null,
        status,
        payment_method: paymentMethod || null,
        our_company_name: ourCompanyName || null,
        our_commercial_reg: ourCommercialReg || null,
        our_vat_number: ourVatNumber || null,
        our_contact_number: ourContactNumber || null,
        our_email: ourEmail || null,
        our_address: ourAddress || null,
        school_name: schoolName,
        school_commercial_reg: schoolCommercialReg || null,
        school_vat_number: schoolVatNumber || null,
        school_contact: schoolContact || null,
        school_email: schoolEmail || null,
        school_address: schoolAddress || null,
        line_items: lineItems.map((r) => ({
          description: r.description,
          quantity: Number(r.quantity) || 0,
          price: Number(r.price) || 0,
          vat: Number(r.vat) || 0,
          total: calcRowTotal(r.price, r.vat),
        })),
        total_amount: grandTotal,
      });

      onIssued(res.data);
      onClose();
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? "حدث خطأ" : "حدث خطأ");
    } finally {
      setGenerating(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-[#1e1e2e] rounded-2xl border border-white/10 w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-white">إنشاء فاتورة</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            ×
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-white/10 border-t-emerald-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            {error && (
              <div className="p-3 bg-red-950/50 border border-red-500/30 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Our company info */}
            <div className="bg-[#161622] rounded-xl p-4 border border-white/5">
              <h4 className="text-sm font-bold text-white mb-3">معلومات مزود الخدمة (شركتنا)</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="اسم الشركة"><input value={ourCompanyName} onChange={(e) => setOurCompanyName(e.target.value)} className="input-admin" /></Field>
                <Field label="رقم السجل التجاري"><input value={ourCommercialReg} onChange={(e) => setOurCommercialReg(e.target.value)} className="input-admin" /></Field>
                <Field label="الرقم الضريبي"><input value={ourVatNumber} onChange={(e) => setOurVatNumber(e.target.value)} className="input-admin" /></Field>
                <Field label="رقم التواصل"><input value={ourContactNumber} onChange={(e) => setOurContactNumber(e.target.value)} className="input-admin" /></Field>
                <Field label="البريد الإلكتروني"><input value={ourEmail} onChange={(e) => setOurEmail(e.target.value)} className="input-admin" dir="ltr" /></Field>
                <Field label="العنوان"><input value={ourAddress} onChange={(e) => setOurAddress(e.target.value)} className="input-admin" /></Field>
              </div>
            </div>

            {/* School info */}
            <div className="bg-[#161622] rounded-xl p-4 border border-white/5">
              <h4 className="text-sm font-bold text-white mb-3">معلومات المدرسة</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="اسم المدرسة"><input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className="input-admin" /></Field>
                <Field label="رقم السجل التجاري"><input value={schoolCommercialReg} onChange={(e) => setSchoolCommercialReg(e.target.value)} className="input-admin" /></Field>
                <Field label="الرقم الضريبي"><input value={schoolVatNumber} onChange={(e) => setSchoolVatNumber(e.target.value)} className="input-admin" /></Field>
                <Field label="رقم التواصل"><input value={schoolContact} onChange={(e) => setSchoolContact(e.target.value)} className="input-admin" /></Field>
                <Field label="البريد الإلكتروني"><input value={schoolEmail} onChange={(e) => setSchoolEmail(e.target.value)} className="input-admin" dir="ltr" /></Field>
                <Field label="العنوان"><input value={schoolAddress} onChange={(e) => setSchoolAddress(e.target.value)} className="input-admin" /></Field>
              </div>
            </div>

            {/* Invoice meta */}
            <div className="bg-[#161622] rounded-xl p-4 border border-white/5">
              <h4 className="text-sm font-bold text-white mb-3">بيانات الفاتورة</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="رقم الفاتورة"><input value={invoiceNumber} readOnly className="input-admin opacity-60" dir="ltr" /></Field>
                <Field label="نوع الاشتراك"><input value={subscriptionType} onChange={(e) => setSubscriptionType(e.target.value)} className="input-admin" /></Field>
                <Field label="تاريخ الإصدار"><input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="input-admin" dir="ltr" /></Field>
                <Field label="تاريخ الاستحقاق"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-admin" dir="ltr" /></Field>
                <Field label="حالة الفاتورة">
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-admin">
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="طريقة الدفع"><input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input-admin" /></Field>
              </div>
            </div>

            {/* Line items */}
            <div>
              <h4 className="text-sm font-bold text-white mb-3">بنود الفاتورة</h4>
              <div className="border border-white/10 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-indigo-600 text-white">
                    <tr>
                      <th className="px-3 py-2 text-right">الوصف</th>
                      <th className="px-3 py-2 text-right w-20">الكمية</th>
                      <th className="px-3 py-2 text-right w-24">السعر</th>
                      <th className="px-3 py-2 text-right w-24">ضريبة (15%)</th>
                      <th className="px-3 py-2 text-right w-24">الإجمالي</th>
                      <th className="px-3 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((row) => (
                      <tr key={row.id} className="border-b border-white/5">
                        <td className="px-2 py-1.5">
                          <input
                            value={row.description}
                            onChange={(e) => updateLineItem(row.id, "description", e.target.value)}
                            className="input-admin"
                            placeholder="الوصف"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min={0}
                            value={row.quantity}
                            onChange={(e) => updateLineItem(row.id, "quantity", e.target.value === "" ? "" : Number(e.target.value))}
                            className="input-admin"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={row.price}
                            onChange={(e) => updateLineItem(row.id, "price", e.target.value === "" ? "" : Number(e.target.value))}
                            className="input-admin"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={row.vat}
                            onChange={(e) => updateLineItem(row.id, "vat", e.target.value === "" ? "" : Number(e.target.value))}
                            className="input-admin"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-sm text-white font-medium">
                          {calcRowTotal(row.price, row.vat).toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5">
                          <button type="button" onClick={() => removeLineItem(row.id)} className="text-red-400 hover:text-red-300 text-lg font-bold leading-none">
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-[#161622]">
                  <button type="button" onClick={addLineItem} className="text-sm text-emerald-400 hover:underline font-medium">
                    + إضافة بند
                  </button>
                </div>
              </div>
            </div>

            {/* Grand total */}
            <div className="flex justify-end">
              <div className="bg-indigo-600 text-white rounded-xl px-6 py-3">
                <span className="text-sm">الإجمالي الكلي: </span>
                <span className="text-lg font-bold">{grandTotal.toFixed(2)} ر.س</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-60"
              >
                {generating ? "جاري الإصدار..." : "إصدار الفاتورة"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 border border-white/10 rounded-xl text-sm text-gray-300 hover:bg-white/5 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-gray-400 text-xs mb-1">{label}</label>
      {children}
    </div>
  );
}
