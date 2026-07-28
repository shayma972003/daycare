"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { STUDENT_FIELD_ALIASES } from "@/lib/import-mapper";

// All possible field names from STUDENT_FIELD_ALIASES
const ALL_STUDENT_FIELDS = Object.keys(STUDENT_FIELD_ALIASES);

const FIELD_LABELS: Record<string, string> = {
  full_name: "اسم الطالب الكامل",
  date_of_birth: "تاريخ الميلاد",
  gender: "الجنس",
  nationality: "الجنسية",
  id_number: "رقم الهوية",
  health_condition: "الحالة الصحية",
  allergies: "الحساسية",
  academic_stage: "المرحلة الدراسية",
  period: "الفترة",
  registration_date: "تاريخ التسجيل",
  enrollment_end_date: "تاريخ انتهاء الاشتراك",
  payment_method: "طريقة الدفع",
  guardian_name: "اسم ولي الأمر",
  guardian_phone_1: "جوال ولي الأمر 1",
  guardian_phone_2: "جوال ولي الأمر 2",
  guardian_email: "البريد الإلكتروني",
};

type MappingEntry = {
  uploadedColumn: string;
  mappedField: string | null;
  confidence: number;
  needs_review: boolean;
};

type ImportRow = {
  id: string;
  row_number: number;
  raw_data: Record<string, unknown>;
  mapped_data: Record<string, unknown> | null;
  status: string;
  errors: Array<{ field: string; message: string; type: string }> | null;
  warnings: Array<{ field: string; message: string; type: string }> | null;
};

type ImportSession = {
  id: string;
  type: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  duplicate_guardians_reused: number;
  column_mapping: MappingEntry[] | null;
  original_headers: string[] | null;
  file_language: string | null;
  rows: ImportRow[];
};

const STEPS = [
  "رفع الملف",
  "المعاينة",
  "تعيين الأعمدة",
  "المراجعة",
  "التأكيد",
  "التقرير",
];

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8 flex-wrap">
      {STEPS.map((label, i) => {
        const stepNum = i + 1;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
                  isCompleted
                    ? "bg-success-bg0 border-success-text text-white"
                    : isCurrent
                    ? "bg-[#1a2340] border-[#1a2340] text-white"
                    : "bg-white border-gray-300 text-gray-400"
                }`}
              >
                {isCompleted ? "✓" : stepNum}
              </div>
              <span
                className={`text-xs mt-1 whitespace-nowrap ${
                  isCurrent ? "text-[#1a2340] font-semibold" : isCompleted ? "text-success-text" : "text-gray-400"
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-10 h-0.5 mx-1 mb-4 ${
                  stepNum < currentStep ? "bg-success-bg0" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function downloadErrorCsv(rows: ImportRow[], fileLanguage: string) {
  const isAr = fileLanguage === "ar";
  const headers = isAr
    ? ["رقم الصف", "اسم الطالب", "رسالة الخطأ"]
    : ["Row Number", "Student Name", "Error Message"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const mapped = row.mapped_data as Record<string, unknown> | null;
    const name = mapped?.full_name ? String(mapped.full_name) : "";
    const errors = (row.errors as Array<{ message: string }> | null) ?? [];
    const errorMsg = errors.map((e) => e.message).join("; ");
    lines.push([row.row_number, `"${name}"`, `"${errorMsg}"`].join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-errors.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function StudentsImportPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{
    total_rows: number;
    preview_rows: Record<string, unknown>[];
    headers: string[];
  } | null>(null);
  const [mapping, setMapping] = useState<MappingEntry[]>([]);
  const [sessionData, setSessionData] = useState<ImportSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmCalledRef = useRef(false);

  // Step 5: auto-run confirm
  useEffect(() => {
    if (step === 5 && sessionId && !confirmCalledRef.current) {
      confirmCalledRef.current = true;
      runConfirm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sessionId]);

  const runConfirm = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      await axios.post(`/api/import/${sessionId}/confirm`);
      // Reload session data for report
      const res = await axios.get<ImportSession>(`/api/import/${sessionId}`);
      setSessionData(res.data);
      setStep(6);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? "فشل الاستيراد" : "فشل الاستيراد");
      setLoading(false);
    }
  }, [sessionId]);

  async function handleFileUpload(file: File) {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "students");
      const res = await axios.post<{
        session_id: string;
        total_rows: number;
        preview_rows: Record<string, unknown>[];
        headers: string[];
      }>("/api/import/upload", fd);
      setSessionId(res.data.session_id);
      setPreviewData({
        total_rows: res.data.total_rows,
        preview_rows: res.data.preview_rows,
        headers: res.data.headers,
      });
      setStep(2);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? "فشل رفع الملف" : "فشل رفع الملف");
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      handleFileUpload(file);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      handleFileUpload(file);
    }
  }

  async function handleDetectMapping() {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post<{ mapping: MappingEntry[] }>(
        `/api/import/${sessionId}/detect-mapping`
      );
      setMapping(res.data.mapping);
      setStep(3);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? "فشل تحليل الأعمدة" : "فشل تحليل الأعمدة");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelAndReset() {
    if (sessionId) {
      await axios.delete(`/api/import/${sessionId}`).catch(() => {});
    }
    setSessionId(null);
    setPreviewData(null);
    setMapping([]);
    setSessionData(null);
    setSelectedFile(null);
    setError(null);
    confirmCalledRef.current = false;
    setStep(1);
  }

  async function handleCancel() {
    if (sessionId) {
      await axios.delete(`/api/import/${sessionId}`).catch(() => {});
    }
    router.push("/students");
  }

  async function handleSaveMappingAndValidate() {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      await axios.put(`/api/import/${sessionId}/mapping`, { mapping });
      const valRes = await axios.post<{ valid_rows: number; error_rows: number }>(
        `/api/import/${sessionId}/validate`
      );
      // Load full session for review
      const sesRes = await axios.get<ImportSession>(`/api/import/${sessionId}`);
      setSessionData(sesRes.data);
      // Update mapping from session
      if (sesRes.data.column_mapping) setMapping(sesRes.data.column_mapping);
      setStep(4);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? "فشل التحقق" : "فشل التحقق");
    } finally {
      setLoading(false);
    }
  }

  function updateMappingField(index: number, newField: string | null) {
    setMapping((prev) =>
      prev.map((entry, i) =>
        i === index ? { ...entry, mappedField: newField, needs_review: false } : entry
      )
    );
  }

  // Render steps
  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title="استيراد الطلاب من ملف" />
      <div className="p-6 max-w-5xl mx-auto">
        <StepIndicator currentStep={step} />

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        {/* STEP 1: Upload */}
        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-md p-8">
            <h2 className="text-xl font-bold text-[#1a2340] mb-2">رفع ملف الطلاب</h2>
            <p className="text-sm text-gray-500 mb-6">يدعم النظام ملفات .xlsx و .csv</p>
            <div
              className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer ${
                dragOver ? "border-[#F64651] bg-success-bg" : "border-gray-200 hover:border-[#1a2340]"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">📄</span>
              </div>
              <p className="text-[#1a2340] font-semibold mb-1">اسحب الملف هنا أو انقر للاختيار</p>
              <p className="text-xs text-gray-400">الصيغ المدعومة: .xlsx, .csv</p>
              {selectedFile && (
                <p className="mt-3 text-sm text-success-text font-medium">
                  تم اختيار: {selectedFile.name}
                </p>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileInputChange}
            />
            {loading && (
              <div className="mt-6 flex items-center justify-center gap-3 text-[#1a2340]">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-[#1a2340] rounded-full animate-spin" />
                <span className="text-sm">جاري رفع الملف...</span>
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleCancel}
                className="px-4 py-2 border border-red-300 text-red-600 rounded-xl text-sm hover:bg-red-50 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Preview */}
        {step === 2 && previewData && (
          <div className="bg-white rounded-2xl shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-[#1a2340]">معاينة الملف</h2>
                <p className="text-sm text-gray-500 mt-1">
                  إجمالي الصفوف المكتشفة:{" "}
                  <span className="font-bold text-[#1a2340]">{previewData.total_rows} صف</span>
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCancelAndReset}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  رفع ملف آخر
                </button>
                <button
                  onClick={handleDetectMapping}
                  disabled={loading}
                  className="px-5 py-2 bg-[#1a2340] text-white rounded-xl text-sm font-medium hover:bg-[#243060] transition-colors disabled:opacity-60 flex items-center gap-2"
                >
                  {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  المتابعة
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 border border-red-300 text-red-600 rounded-xl text-sm hover:bg-red-50 transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#1a2340] text-white">
                    {previewData.headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.preview_rows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      {previewData.headers.map((h) => (
                        <td key={h} className="px-3 py-2 border-b border-gray-100 whitespace-nowrap text-gray-700">
                          {String(row[h] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewData.total_rows > 10 && (
              <p className="text-xs text-gray-400 mt-2 text-center">
                يُعرض أول 10 صفوف فقط من أصل {previewData.total_rows}
              </p>
            )}
          </div>
        )}

        {/* STEP 3: Column Mapping */}
        {step === 3 && mapping.length > 0 && (
          <div className="bg-white rounded-2xl shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-[#1a2340]">تعيين الأعمدة</h2>
                <p className="text-sm text-gray-500 mt-1">تحقق من تعيين كل عمود للحقل الصحيح</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveMappingAndValidate}
                  disabled={loading}
                  className="px-5 py-2 bg-[#1a2340] text-white rounded-xl text-sm font-medium hover:bg-[#243060] transition-colors disabled:opacity-60 flex items-center gap-2"
                >
                  {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  تأكيد التعيين والمتابعة
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 border border-red-300 text-red-600 rounded-xl text-sm hover:bg-red-50 transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-right font-medium text-gray-600">عمود الملف</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">الحقل المعيّن</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">الثقة</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.map((entry, index) => (
                    <tr
                      key={index}
                      className={`border-b ${
                        entry.needs_review && !entry.mappedField
                          ? "bg-yellow-50"
                          : "bg-white"
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-[#1a2340]">{entry.uploadedColumn}</td>
                      <td className="px-4 py-3">
                        <select
                          value={entry.mappedField ?? ""}
                          onChange={(e) => updateMappingField(index, e.target.value || null)}
                          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340] w-full"
                        >
                          <option value="">تجاهل هذا العمود</option>
                          {ALL_STUDENT_FIELDS.map((field) => (
                            <option key={field} value={field}>
                              {FIELD_LABELS[field] ?? field}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {entry.mappedField ? (
                          <span className="text-gray-600">{Math.round(entry.confidence * 100)}%</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {entry.mappedField && entry.confidence >= 0.7 ? (
                          <span className="text-success-text text-lg">✓</span>
                        ) : entry.mappedField ? (
                          <span className="text-blue-500 text-xs bg-blue-50 px-2 py-0.5 rounded-full">مراجعة</span>
                        ) : (
                          <span className="text-yellow-600 text-xs bg-yellow-50 px-2 py-0.5 rounded-full">غير محدد</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* STEP 4: Review */}
        {step === 4 && sessionData && (
          <div className="bg-white rounded-2xl shadow-md p-6">
            <h2 className="text-xl font-bold text-[#1a2340] mb-4">مراجعة البيانات</h2>

            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 rounded-xl p-4 text-center border border-gray-100">
                <div className="text-3xl font-bold text-[#1a2340]">{sessionData.total_rows}</div>
                <div className="text-sm text-gray-500 mt-1">إجمالي الصفوف المكتشفة</div>
              </div>
              <div className="bg-success-bg rounded-xl p-4 text-center border border-success-text/15">
                <div className="text-3xl font-bold text-success-text">{sessionData.valid_rows}</div>
                <div className="text-sm text-gray-500 mt-1">صفوف صحيحة جاهزة للاستيراد</div>
              </div>
              <div className="bg-red-50 rounded-xl p-4 text-center border border-red-100">
                <div className="text-3xl font-bold text-red-600">{sessionData.error_rows}</div>
                <div className="text-sm text-gray-500 mt-1">صفوف تحتوي على أخطاء</div>
              </div>
            </div>

            {/* Error rows list */}
            {sessionData.error_rows > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-red-700 mb-2">الصفوف التي تحتوي على أخطاء:</h3>
                <div className="border border-red-100 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                  {sessionData.rows
                    .filter((r) => r.status === "error")
                    .map((row) => (
                      <div
                        key={row.id}
                        className="px-4 py-2 border-b border-red-50 last:border-b-0 bg-red-50/50"
                      >
                        <span className="text-xs font-medium text-gray-500">صف {row.row_number}: </span>
                        <span className="text-xs text-[#1a2340] font-medium">
                          {String((row.mapped_data as Record<string, unknown>)?.full_name ?? (row.raw_data as Record<string, unknown>)?.[Object.keys(row.raw_data as Record<string, unknown>)[0]] ?? "")}
                        </span>
                        <div className="mt-0.5">
                          {(row.errors ?? []).map((e, i) => (
                            <span key={i} className="text-xs text-red-600 ml-2">• {e.message}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancel}
                className="px-4 py-2 border border-red-300 text-red-600 rounded-xl text-sm hover:bg-red-50 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-5 py-2 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                العودة للمراجعة
              </button>
              {sessionData.valid_rows > 0 && (
                <button
                  onClick={() => { confirmCalledRef.current = false; setStep(5); }}
                  className="px-6 py-2 bg-[#F64651] text-white rounded-xl text-sm font-bold hover:bg-[#D93A44] transition-colors"
                >
                  تأكيد الاستيراد ({sessionData.valid_rows} طالب)
                </button>
              )}
            </div>
          </div>
        )}

        {/* STEP 5: Importing */}
        {step === 5 && (
          <div className="bg-white rounded-2xl shadow-md p-12 flex flex-col items-center justify-center gap-6">
            <div className="w-16 h-16 border-4 border-gray-100 border-t-[#F64651] rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-xl font-bold text-[#1a2340]">جاري الاستيراد...</p>
              <p className="text-sm text-gray-500 mt-1">يرجى الانتظار، لا تغلق الصفحة</p>
            </div>
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        )}

        {/* STEP 6: Report */}
        {step === 6 && sessionData && (
          <div className="bg-white rounded-2xl shadow-md p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-success-bg rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-3xl">✓</span>
              </div>
              <h2 className="text-xl font-bold text-[#1a2340]">تم الاستيراد بنجاح</h2>
            </div>

            {/* Report summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-success-bg rounded-xl p-4 text-center border border-success-text/15">
                <div className="text-2xl font-bold text-success-text">
                  {sessionData.rows.filter((r) => r.status === "imported").length}
                </div>
                <div className="text-xs text-gray-500 mt-1">تم استيرادهم</div>
              </div>
              <div className="bg-red-50 rounded-xl p-4 text-center border border-red-100">
                <div className="text-2xl font-bold text-red-600">
                  {sessionData.rows.filter((r) => r.status === "skipped").length}
                </div>
                <div className="text-xs text-gray-500 mt-1">تم تخطيهم</div>
              </div>
              <div className="bg-yellow-50 rounded-xl p-4 text-center border border-yellow-100">
                <div className="text-2xl font-bold text-yellow-600">
                  {sessionData.rows.filter((r) => (r.warnings?.length ?? 0) > 0).length}
                </div>
                <div className="text-xs text-gray-500 mt-1">صفوف بتحذيرات</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-4 text-center border border-blue-100">
                <div className="text-2xl font-bold text-blue-600">
                  {sessionData.duplicate_guardians_reused}
                </div>
                <div className="text-xs text-gray-500 mt-1">أولياء أمور مكررون تم ربطهم</div>
              </div>
            </div>

            {/* Skipped rows */}
            {sessionData.rows.filter((r) => r.status === "skipped").length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-red-700 mb-2">الصفوف التي تم تخطيها:</h3>
                <div className="border border-red-100 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                  {sessionData.rows
                    .filter((r) => r.status === "skipped")
                    .map((row) => (
                      <div key={row.id} className="px-4 py-2 border-b border-red-50 last:border-b-0 bg-red-50/50">
                        <span className="text-xs font-medium text-gray-500">صف {row.row_number}: </span>
                        <span className="text-xs text-[#1a2340] font-medium">
                          {String((row.mapped_data as Record<string, unknown>)?.full_name ?? "")}
                        </span>
                        <div className="mt-0.5">
                          {(row.errors ?? []).map((e, i) => (
                            <span key={i} className="text-xs text-red-600 ml-2">• {e.message}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end flex-wrap">
              {sessionData.rows.filter((r) => r.status === "skipped").length > 0 && (
                <button
                  onClick={() => downloadErrorCsv(
                    sessionData.rows.filter((r) => r.status === "skipped"),
                    sessionData.file_language ?? "ar"
                  )}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  تنزيل تقرير الأخطاء
                </button>
              )}
              <button
                onClick={() => router.push("/students")}
                className="px-5 py-2 bg-[#1a2340] text-white rounded-xl text-sm font-medium hover:bg-[#243060] transition-colors"
              >
                العودة إلى قائمة الطلاب
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
