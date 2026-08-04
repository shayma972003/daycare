"use client";

import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import axios from "axios";
import { useT } from "@/lib/i18n-provider";

interface LineItem {
  id: string;
  description: string;
  qty: number | "";
  price: number | "";
}

interface ActivityItem {
  id: string;
  description: string;
  qty: number | "";
  price: number | "";
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
  student: { name: string; idNumber: string | null; className: string | null; paymentMethod: string };
  guardian: { name: string | null; phone1: string | null; email: string | null };
  invoiceNumber: string;
  issuedAt: string;
  activities: Array<{ id: string; name: string; fee: number }>;
}

interface IssuedInvoice {
  id: string;
  amount: number;
  pdfUrl: string | null;
  createdAt: string;
}

interface InvoiceModalProps {
  open: boolean;
  studentId: string;
  onClose: () => void;
  onIssued: (invoice: IssuedInvoice) => void;
}

const inputCls =
  "w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]";
const tdInput =
  "border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-[#F64651]";

function calcTotal(items: Array<{ qty: number | ""; price: number | "" }>) {
  return items.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
}

export function InvoiceModal({ open, studentId, onClose, onIssued }: InvoiceModalProps) {
  const t = useT();
  const [prefill, setPrefill] = useState<PrefillData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [schoolName, setSchoolName] = useState("");
  const [commercialReg, setCommercialReg] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [address, setAddress] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [dueDate, setDueDate] = useState("");
    // The Arabic literal, not t("paymentStatus.PAID"): this value is posted to
  // the API and matched against the <option value="…"> list below, both of
  // which are Arabic. Translating it would write "Paid" into the column.
  const [invoiceStatus, setInvoiceStatus] = useState("مدفوع");

  const [studentName, setStudentName] = useState("");
  const [studentIdNum, setStudentIdNum] = useState("");
  const [className, setClassName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");

  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: "1", description: "", qty: 1, price: 0 },
  ]);

  const [includeActivities, setIncludeActivities] = useState(false);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [noActivities, setNoActivities] = useState(false);

  const [hasDiscount, setHasDiscount] = useState(false);
  // Stored on the invoice line, so it stays in the document language.
  const [discountLabel, setDiscountLabel] = useState("التخفيض");
  const [discountPercent, setDiscountPercent] = useState(15);

  const [hasVat, setHasVat] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setIncludeActivities(false);
    setActivityItems([]);
    setLineItems([{ id: "1", description: "", qty: 1, price: 0 }]);
    setHasDiscount(false);
    setDiscountLabel(t("fields.discount"));
    setDiscountPercent(15);
    setHasVat(false);
    axios
      .get<PrefillData>(`/api/invoices/prefill/${studentId}`)
      .then((res) => {
        const d = res.data;
        setPrefill(d);
        setSchoolName(d.school.name ?? "");
        setCommercialReg(d.school.commercialRegistration ?? "");
        setVatNumber(d.school.vatNumber ?? "");
        setContactNumber(d.school.contactNumber ?? "");
        setSchoolEmail(d.school.email ?? "");
        setAddress(d.school.address ?? "");
        setInvoiceNumber(d.invoiceNumber);
        setIssuedAt(d.issuedAt);
        setDueDate("");
        setInvoiceStatus("مدفوع");
        setStudentName(d.student.name ?? "");
        setStudentIdNum(d.student.idNumber ?? "");
        setClassName(d.student.className ?? "");
        setGuardianName(d.guardian.name ?? "");
        setGuardianPhone(d.guardian.phone1 ?? "");
        setGuardianEmail(d.guardian.email ?? "");
        setPaymentMethod(d.student.paymentMethod ?? "");
      })
      .catch(() => setError(t("common.loadFailed")))
      .finally(() => setLoading(false));
  }, [open, studentId, t]);

  useEffect(() => {
    if (!prefill) return;
    if (includeActivities) {
      const acts = prefill.activities ?? [];
      if (acts.length === 0) {
        setNoActivities(true);
        setActivityItems([]);
      } else {
        setNoActivities(false);
        setActivityItems(
          acts.map((a) => ({
            id: a?.id ?? String(Math.random()),
            description: a?.name ?? "",
            qty: "" as const,
            price: a?.fee ?? 0,
          }))
        );
      }
    }
  }, [includeActivities, prefill]);

  function addLineItem() {
    setLineItems((prev) => [
      ...prev,
      { id: Date.now().toString(), description: "", qty: 1, price: 0 },
    ]);
  }

  function removeLineItem(id: string) {
    setLineItems((prev) => prev.filter((r) => r.id !== id));
  }

  function updateLineItem(id: string, field: keyof LineItem, value: string | number) {
    setLineItems((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function updateActivityItem(id: string, field: keyof ActivityItem, value: string | number) {
    setActivityItems((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const baseTotal = calcTotal(lineItems);
      const activitiesTotal =
        includeActivities && !noActivities ? calcTotal(activityItems) : 0;
      const discountAmount = hasDiscount ? (baseTotal * discountPercent) / 100 : 0;
      const vatAmount = hasVat ? baseTotal * 0.15 : 0;
      const grandTotal = baseTotal + vatAmount + activitiesTotal - discountAmount;

      const res = await axios.post<IssuedInvoice & { type: string }>("/api/invoices/generate", {
        studentId,
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
          student: { name: studentName, idNumber: studentIdNum || null, className: className || null },
          guardian: {
            name: guardianName || null,
            phone1: guardianPhone || null,
            email: guardianEmail || null,
          },
          paymentMethod,
          lineItems: lineItems.map((r) => ({
            description: r.description,
            qty: Number(r.qty) || 0,
            price: Number(r.price) || 0,
            total: (Number(r.qty) || 0) * (Number(r.price) || 0),
          })),
          activityItems:
            includeActivities && !noActivities
              ? activityItems.map((r) => ({
                  description: r.description,
                  qty: Number(r.qty) || 0,
                  price: Number(r.price) || 0,
                  total: (Number(r.qty) || 0) * (Number(r.price) || 0),
                }))
              : [],
          baseTotal,
          activitiesTotal,
          hasDiscount,
          discountLabel: hasDiscount ? discountLabel : null,
          discountPercent: hasDiscount ? discountPercent : null,
          discountAmount,
          hasVat,
          vatAmount,
          grandTotal,
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
        axios.isAxiosError(err) ? err.response?.data?.error ?? t("common.somethingWentWrong") : t("common.somethingWentWrong")
      );
    } finally {
      setGenerating(false);
    }
  }

  const baseTotalView = calcTotal(lineItems);
  const activitiesTotalView = includeActivities && !noActivities ? calcTotal(activityItems) : 0;
  const discountAmountView = hasDiscount ? (baseTotalView * discountPercent) / 100 : 0;
  const vatAmountView = hasVat ? baseTotalView * 0.15 : 0;
  const grandTotal = baseTotalView + vatAmountView + activitiesTotalView - discountAmountView;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          dir="rtl"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-modal w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 focus:outline-none animate-scale-in"
        >
          <Dialog.Description className="sr-only">{t("invoiceForm.ariaTitle")}</Dialog.Description>
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-lg font-bold text-[#111111]">{t("invoiceForm.issue")}</Dialog.Title>
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
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {error}
                </div>
              )}

              {/* School info */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-[#111111] mb-3">{t("invoiceForm.schoolDetails")}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("invoiceForm.schoolName")}</label>
                    <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("settings.commercialReg")}</label>
                    <input value={commercialReg} onChange={(e) => setCommercialReg(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("settings.vatNumber")}</label>
                    <input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("settings.contactNumber")}</label>
                    <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("fields.email")}</label>
                    <input value={schoolEmail} onChange={(e) => setSchoolEmail(e.target.value)} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("settings.address")}</label>
                    <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
                  </div>
                </div>
              </div>

              {/* Invoice meta */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-[#111111] mb-3">{t("invoiceForm.invoiceDetails")}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("invoiceForm.invoiceNumber")}</label>
                    <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={inputCls} dir="ltr" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("finance.issuedOn")}</label>
                    <input value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("invoiceForm.dueDate")}</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className={inputCls}
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("invoiceForm.invoiceStatus")}</label>
                    <select value={invoiceStatus} onChange={(e) => setInvoiceStatus(e.target.value)} className={inputCls}>
                      <option value="مدفوع">{t("invoiceForm.paidStatus")}</option>
                      <option value="متأخر">{t("invoiceForm.lateStatus")}</option>
                      <option value="ملغي">{t("invoiceForm.cancelledStatus")}</option>
                      <option value="موقف">{t("invoiceForm.suspendedStatus")}</option>
                      <option value="بانتظار الدفع">{t("invoiceForm.pendingStatus")}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Student / Guardian */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-[#111111] mb-3">{t("invoiceForm.partyDetails")}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("fields.childName")}</label>
                    <input value={studentName} onChange={(e) => setStudentName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("fields.studentNumber")}</label>
                    <input value={studentIdNum} onChange={(e) => setStudentIdNum(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("invoiceForm.grade")}</label>
                    <input value={className} onChange={(e) => setClassName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("fields.paymentMethod")}</label>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
                      <option value="CASH">{t("fields.cash")}</option>
                      <option value="TRANSFER">{t("invoiceForm.bankTransfer")}</option>
                      <option value="CARD">{t("invoiceForm.card")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("fields.guardianName")}</label>
                    <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t("invoiceForm.mobile")}</label>
                    <input value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)} className={inputCls} dir="ltr" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 block mb-1">{t("fields.guardianEmail")}</label>
                    <input value={guardianEmail} onChange={(e) => setGuardianEmail(e.target.value)} className={inputCls} dir="ltr" />
                  </div>
                </div>
              </div>

              {/* Main line items */}
              <div>
                <h3 className="text-sm font-bold text-[#111111] mb-3">{t("invoiceForm.lineItems")}</h3>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100 text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-right">{t("fields.description")}</th>
                        <th className="px-3 py-2 text-right w-20">{t("careForm.amount")}</th>
                        <th className="px-3 py-2 text-right w-24">{t("finance.price")}</th>
                        <th className="px-3 py-2 text-right w-24">{t("fields.total")}</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((row) => (
                        <tr key={row.id} className="border-b border-gray-100">
                          <td className="px-2 py-1.5">
                            <input
                              value={row.description}
                              onChange={(e) => updateLineItem(row.id, "description", e.target.value)}
                              className={tdInput}
                              placeholder={t("fields.description")}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min={0}
                              value={row.qty}
                              onChange={(e) =>
                                updateLineItem(row.id, "qty", e.target.value === "" ? "" : Number(e.target.value))
                              }
                              className={tdInput}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={row.price}
                              onChange={(e) =>
                                updateLineItem(row.id, "price", e.target.value === "" ? "" : Number(e.target.value))
                              }
                              className={tdInput}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-sm text-gray-700 font-medium">
                            {((Number(row.qty) || 0) * (Number(row.price) || 0)).toFixed(2)}
                          </td>
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              onClick={() => removeLineItem(row.id)}
                              className="text-red-400 hover:text-red-600 text-lg font-bold leading-none"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                      {hasDiscount && (
                        <tr className="border-t border-dashed border-gray-200">
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={discountLabel}
                              onChange={(e) => setDiscountLabel(e.target.value)}
                              className={tdInput}
                              placeholder={t("fields.discount")}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-center text-gray-300 text-sm">—</td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1 justify-center">
                              <span className="text-sm text-gray-400">%</span>
                              <input
                                type="number"
                                value={discountPercent}
                                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                                min={0}
                                max={100}
                                className="w-16 text-center text-sm px-2 py-1 border border-gray-200 rounded-md focus:border-teal focus:outline-none"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <span className="text-sm font-medium" style={{ color: "#F64651" }}>
                              -{((calcTotal(lineItems) * discountPercent) / 100).toFixed(2)} {t("finance.sar")}
                            </span>
                          </td>
                          <td />
                        </tr>
                      )}
                      {hasVat && (
                        <tr className="border-t border-dashed border-gray-200">
                          <td className="px-3 py-2 text-right text-sm">{t("invoiceForm.vat")}</td>
                          <td className="px-3 py-2 text-center text-gray-300 text-sm">—</td>
                          <td className="px-3 py-2 text-center text-sm text-gray-500">15%</td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-sm font-medium text-gray-700">
                              +{((calcTotal(lineItems) * 15) / 100).toFixed(2)} {t("finance.sar")}
                            </span>
                          </td>
                          <td />
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <div className="px-3 py-2 flex items-center justify-between bg-gray-50">
                    <button
                      type="button"
                      onClick={addLineItem}
                      className="text-sm text-[#F64651] hover:underline font-medium"
                    >
                      {t("invoiceForm.addRow")}
                    </button>
                    <span className="text-sm font-bold text-[#111111]">
                      {t("finance.totalColon", { amount: calcTotal(lineItems).toFixed(2) })}
                    </span>
                  </div>
                </div>

                {/* Discount checkbox */}
                <div className="flex items-center gap-3 justify-end mt-3">
                  <label className="text-sm text-gray-700 font-medium cursor-pointer" htmlFor="discount-checkbox">
                    {t("invoiceForm.addDiscount")}
                  </label>
                  <input
                    id="discount-checkbox"
                    type="checkbox"
                    checked={hasDiscount}
                    onChange={(e) => {
                      setHasDiscount(e.target.checked);
                      if (!e.target.checked) {
                        setDiscountLabel(t("fields.discount"));
                        setDiscountPercent(15);
                      }
                    }}
                    className="w-4 h-4 accent-teal cursor-pointer"
                  />
                </div>

                {/* VAT checkbox */}
                <div className="flex items-center gap-3 justify-end mt-2">
                  <label className="text-sm text-gray-700 font-medium cursor-pointer" htmlFor="vat-checkbox">
                    {t("invoiceForm.vat")}
                  </label>
                  <input
                    id="vat-checkbox"
                    type="checkbox"
                    checked={hasVat}
                    onChange={(e) => setHasVat(e.target.checked)}
                    className="w-4 h-4 accent-teal cursor-pointer"
                  />
                </div>
              </div>

              {/* Activities checkbox */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeActivities}
                    onChange={(e) => setIncludeActivities(e.target.checked)}
                    className="w-4 h-4 accent-[#F64651]"
                  />
                  <span className="text-sm font-medium text-[#111111]">{t("invoiceForm.addActivities")}</span>
                </label>

                {includeActivities && (
                  <div className="mt-3">
                    {noActivities ? (
                      <p className="text-sm text-gray-400 py-3 text-center border border-gray-100 rounded-xl">
                        {t("invoiceForm.noActivities")}
                      </p>
                    ) : (
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                          <span className="text-xs font-semibold text-gray-600">{t("fields.activities")}</span>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-100 text-gray-500">
                            <tr>
                              <th className="px-3 py-2 text-right">{t("fields.description")}</th>
                              <th className="px-3 py-2 text-right w-20">{t("careForm.amount")}</th>
                              <th className="px-3 py-2 text-right w-24">{t("finance.price")}</th>
                              <th className="px-3 py-2 text-right w-24">{t("fields.total")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activityItems.map((row) => (
                              <tr key={row.id} className="border-b border-gray-100">
                                <td className="px-2 py-1.5">
                                  <input
                                    value={row.description}
                                    onChange={(e) => updateActivityItem(row.id, "description", e.target.value)}
                                    className={tdInput}
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="number"
                                    min={0}
                                    value={row.qty}
                                    onChange={(e) =>
                                      updateActivityItem(row.id, "qty", e.target.value === "" ? "" : Number(e.target.value))
                                    }
                                    className={tdInput}
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={row.price}
                                    onChange={(e) =>
                                      updateActivityItem(row.id, "price", e.target.value === "" ? "" : Number(e.target.value))
                                    }
                                    className={tdInput}
                                  />
                                </td>
                                <td className="px-3 py-1.5 text-sm text-gray-700 font-medium">
                                  {((Number(row.qty) || 0) * (Number(row.price) || 0)).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="px-3 py-2 bg-gray-50 flex justify-end">
                          <span className="text-sm font-bold text-[#111111]">
                            {t("finance.activitiesTotal", { amount: calcTotal(activityItems).toFixed(2) })}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Grand total */}
              <div className="text-right space-y-1 mt-3 pt-3 border-t border-gray-100">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>{baseTotalView.toFixed(2)} {t("finance.sar")}</span>
                  <span>{t("fields.subtotal")}</span>
                </div>
                {hasVat && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>+{vatAmountView.toFixed(2)} {t("finance.sar")}</span>
                    <span>{t("invoiceForm.vatPercent")}</span>
                  </div>
                )}
                {includeActivities && !noActivities && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>+{activitiesTotalView.toFixed(2)} {t("finance.sar")}</span>
                    <span>{t("invoiceForm.activityFees")}</span>
                  </div>
                )}
                {hasDiscount && (
                  <div className="flex justify-between text-sm text-coral">
                    <span>-{discountAmountView.toFixed(2)} {t("finance.sar")}</span>
                    <span>{t("finance.discountPercent", { percent: String(discountPercent) })}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-gray-200">
                  <span>{grandTotal.toFixed(2)} {t("finance.sar")}</span>
                  <span>{t("fields.grandTotal")}</span>
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
                  {generating ? t("invoiceForm.issuing") : t("invoiceForm.issueAction")}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
