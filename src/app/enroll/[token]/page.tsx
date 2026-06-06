"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import axios from "axios";

// ─── Types ───────────────────────────────────────────────────────────────────

type TokenState =
  | { state: "loading" }
  | { state: "expired" }
  | { state: "limit_reached"; max: number }
  | { state: "otp"; maskedPhone: string; school: SchoolInfo; otpVerified: boolean }
  | { state: "form"; school: SchoolInfo; submissionsCount: number; maxSubmissions: number }
  | { state: "done"; childName: string; school: SchoolInfo; submissionsCount: number; maxSubmissions: number };

interface SchoolInfo {
  name: string;
  logoUrl: string | null;
}

interface GuardianPrefill {
  guardian_name?: string;
  guardian_phone_1?: string;
  guardian_phone_2?: string;
  guardian_email?: string;
  guardian_name_2?: string;
  guardian_phone_3?: string;
  guardian_phone_4?: string;
  guardian_email_2?: string;
}

// ─── OTP Input ───────────────────────────────────────────────────────────────

function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  function handleChange(i: number, v: string) {
    const digit = v.replace(/\D/g, "").slice(-1);
    const arr = value.padEnd(6, " ").split("").map((c) => (c === " " ? "" : c));
    arr[i] = digit;
    const next = arr.join("");
    onChange(next);
    if (digit && i < 5) inputs.current[i + 1]?.focus();
  }

  return (
    <div className="flex gap-3 justify-center" dir="ltr">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { inputs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          className="w-12 h-14 text-center text-xl font-bold border-2 border-gray-300 rounded-xl focus:border-[#22c55e] focus:outline-none bg-white shadow-sm"
        />
      ))}
    </div>
  );
}

// ─── School Header ────────────────────────────────────────────────────────────

function SchoolHeader({ school }: { school: SchoolInfo }) {
  return (
    <div className="flex flex-col items-center gap-3 mb-6">
      <div className="w-20 h-20 rounded-2xl bg-[#1a2340] flex items-center justify-center text-white font-bold text-2xl overflow-hidden">
        {school.logoUrl ? (
          <img src={school.logoUrl} alt={school.name} className="w-full h-full object-cover" />
        ) : (
          school.name.slice(0, 2)
        )}
      </div>
      <h1 className="text-xl font-bold text-[#1a2340]">{school.name}</h1>
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["التحقق", "معلومات التسجيل", "تأكيد"];
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <div key={i} className="flex items-center">
            <div className={`flex items-center gap-1.5 ${active ? "text-[#22c55e]" : done ? "text-gray-400" : "text-gray-300"}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2
                ${active ? "border-[#22c55e] bg-[#22c55e] text-white" : done ? "border-gray-300 bg-gray-100 text-gray-400" : "border-gray-200 text-gray-300"}`}>
                {done ? "✓" : n}
              </div>
              <span className="text-xs font-medium hidden sm:block">{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-6 h-0.5 mx-2 ${done ? "bg-gray-300" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
      <h3 className="text-base font-bold text-[#1a2340] mb-4 pb-3 border-b border-gray-100">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e] focus:border-transparent bg-white min-h-[48px]";
const selectCls = `${inputCls} appearance-none`;

// ─── Enrollment Form ──────────────────────────────────────────────────────────

function EnrollmentForm({
  token,
  school,
  initialGuardian,
  submissionsCount,
  maxSubmissions,
  onSuccess,
}: {
  token: string;
  school: SchoolInfo;
  initialGuardian: GuardianPrefill;
  submissionsCount: number;
  maxSubmissions: number;
  onSuccess: (childName: string, newCount: number, guardian: GuardianPrefill) => void;
}) {
  const [form, setForm] = useState({
    full_name: "",
    id_number: "",
    nationality: "",
    academic_stage: "",
    gender: "",
    period: "",
    date_of_birth: "",
    health_condition: "",
    allergies: "",
    attendance_type: "",
    payment_method: "",
    guardian_name: initialGuardian.guardian_name ?? "",
    guardian_phone_1: initialGuardian.guardian_phone_1 ?? "",
    guardian_phone_2: initialGuardian.guardian_phone_2 ?? "",
    guardian_email: initialGuardian.guardian_email ?? "",
    guardian_name_2: initialGuardian.guardian_name_2 ?? "",
    guardian_phone_3: initialGuardian.guardian_phone_3 ?? "",
    guardian_phone_4: initialGuardian.guardian_phone_4 ?? "",
    guardian_email_2: initialGuardian.guardian_email_2 ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: string, val: string) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setError("الاسم الكامل مطلوب");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await axios.post<{ success: boolean; submissions_count: number }>("/api/enrollment/submit", {
        token,
        ...form,
      });
      const guardian: GuardianPrefill = {
        guardian_name: form.guardian_name,
        guardian_phone_1: form.guardian_phone_1,
        guardian_phone_2: form.guardian_phone_2,
        guardian_email: form.guardian_email,
        guardian_name_2: form.guardian_name_2,
        guardian_phone_3: form.guardian_phone_3,
        guardian_phone_4: form.guardian_phone_4,
        guardian_email_2: form.guardian_email_2,
      };
      onSuccess(form.full_name, res.data.submissions_count, guardian);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error ?? "حدث خطأ. حاول مرة أخرى.");
      } else {
        setError("حدث خطأ. حاول مرة أخرى.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card title="معلومات الطالب">
        <Field label="الاسم الكامل" required>
          <input className={inputCls} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="أدخل الاسم الكامل" />
        </Field>
        <Field label="رقم الإقامة / الهوية">
          <input className={inputCls} value={form.id_number} onChange={(e) => set("id_number", e.target.value)} />
        </Field>
        <Field label="الجنسية">
          <input className={inputCls} value={form.nationality} onChange={(e) => set("nationality", e.target.value)} placeholder="مثال: سعودي" />
        </Field>
        <Field label="المرحلة الدراسية">
          <input className={inputCls} value={form.academic_stage} onChange={(e) => set("academic_stage", e.target.value)} placeholder="مثال: KG1" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الجنس">
            <select className={selectCls} value={form.gender} onChange={(e) => set("gender", e.target.value)}>
              <option value="">اختر</option>
              <option value="ذكر">ذكر</option>
              <option value="أنثى">أنثى</option>
            </select>
          </Field>
          <Field label="الفترة">
            <select className={selectCls} value={form.period} onChange={(e) => set("period", e.target.value)}>
              <option value="">اختر</option>
              <option value="صباحي">صباحي</option>
              <option value="مسائي">مسائي</option>
            </select>
          </Field>
        </div>
        <Field label="تاريخ الميلاد">
          <input type="date" className={inputCls} value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />
        </Field>
      </Card>

      <Card title="المعلومات الصحية">
        <Field label="الحالة الصحية">
          <textarea className={`${inputCls} h-20 resize-none`} value={form.health_condition} onChange={(e) => set("health_condition", e.target.value)} placeholder="أي حالات صحية خاصة..." />
        </Field>
        <Field label="الحساسيات والتنبيهات">
          <textarea className={`${inputCls} h-20 resize-none`} value={form.allergies} onChange={(e) => set("allergies", e.target.value)} placeholder="الحساسيات إن وجدت..." />
        </Field>
      </Card>

      <Card title="معلومات ولي الأمر">
        <Field label="اسم ولي الأمر" required>
          <input className={inputCls} value={form.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} />
        </Field>
        <Field label="رقم الجوال 1" required>
          <input className={inputCls} value={form.guardian_phone_1} onChange={(e) => set("guardian_phone_1", e.target.value)} type="tel" dir="ltr" />
        </Field>
        <Field label="رقم الجوال 2">
          <input className={inputCls} value={form.guardian_phone_2} onChange={(e) => set("guardian_phone_2", e.target.value)} type="tel" dir="ltr" />
        </Field>
        <Field label="البريد الإلكتروني">
          <input className={inputCls} value={form.guardian_email} onChange={(e) => set("guardian_email", e.target.value)} type="email" dir="ltr" />
        </Field>
        <Field label="اسم ولي الأمر 2">
          <input className={inputCls} value={form.guardian_name_2} onChange={(e) => set("guardian_name_2", e.target.value)} />
        </Field>
        <Field label="رقم الجوال 3">
          <input className={inputCls} value={form.guardian_phone_3} onChange={(e) => set("guardian_phone_3", e.target.value)} type="tel" dir="ltr" />
        </Field>
        <Field label="رقم الجوال 4">
          <input className={inputCls} value={form.guardian_phone_4} onChange={(e) => set("guardian_phone_4", e.target.value)} type="tel" dir="ltr" />
        </Field>
        <Field label="البريد الإلكتروني 2">
          <input className={inputCls} value={form.guardian_email_2} onChange={(e) => set("guardian_email_2", e.target.value)} type="email" dir="ltr" />
        </Field>
      </Card>

      <Card title="معلومات التسجيل">
        <Field label="طبيعة الدوام">
          <select className={selectCls} value={form.attendance_type} onChange={(e) => set("attendance_type", e.target.value)}>
            <option value="">اختر</option>
            <option value="دوام منتظم">دوام منتظم</option>
            <option value="شفتات">شفتات</option>
            <option value="غيره">غيره</option>
          </select>
        </Field>
        <Field label="طريقة الدفع">
          <select className={selectCls} value={form.payment_method} onChange={(e) => set("payment_method", e.target.value)}>
            <option value="">اختر</option>
            <option value="نقدي">نقدي</option>
            <option value="تحويل">تحويل</option>
          </select>
        </Field>
      </Card>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
          {error}
        </div>
      )}

      <div className="pb-2">
        <p className="text-xs text-gray-400 text-center mb-3">
          الطلب {submissionsCount + 1} من {maxSubmissions} المسموح بها في هذا الرابط
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-4 bg-[#22c55e] text-white rounded-2xl font-bold text-base hover:bg-[#16a34a] transition-colors disabled:opacity-50 min-h-[56px]"
        >
          {submitting ? "جاري الإرسال..." : "إرسال طلب التسجيل"}
        </button>
      </div>
    </form>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EnrollPage() {
  const { token } = useParams<{ token: string }>();
  const [page, setPage] = useState<TokenState>({ state: "loading" });
  const [guardianPrefill, setGuardianPrefill] = useState<GuardianPrefill>({});
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [resending, setResending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startResendTimer = useCallback(() => {
    setResendTimer(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendTimer((t) => {
        if (t <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0; }
        return t - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    async function checkToken() {
      try {
        const res = await axios.get<{
          valid: boolean;
          otpVerified: boolean;
          maskedPhone: string;
          submissionsCount: number;
          maxSubmissions: number;
          school: SchoolInfo;
        }>(`/api/enrollment/verify-token/${token}`);

        if (res.data.otpVerified) {
          const stored = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("enrollment_verified") : null;
          if (stored === token) {
            setPage({
              state: "form",
              school: res.data.school,
              submissionsCount: res.data.submissionsCount,
              maxSubmissions: res.data.maxSubmissions,
            });
            return;
          }
        }

        setPage({
          state: "otp",
          maskedPhone: res.data.maskedPhone,
          school: res.data.school,
          otpVerified: res.data.otpVerified,
        });
        startResendTimer();
      } catch (err) {
        if (axios.isAxiosError(err)) {
          if (err.response?.status === 410) setPage({ state: "expired" });
          else if (err.response?.status === 429) setPage({ state: "limit_reached", max: err.response.data.max ?? 4 });
          else setPage({ state: "expired" });
        } else {
          setPage({ state: "expired" });
        }
      }
    }
    if (token) checkToken();
  }, [token, startResendTimer]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  async function handleVerifyOtp() {
    if (otp.replace(/\s/g, "").length < 6) {
      setOtpError("أدخل الرمز المكون من 6 أرقام");
      return;
    }
    setVerifying(true);
    setOtpError(null);
    try {
      const res = await axios.post<{ success: boolean; school: SchoolInfo }>("/api/enrollment/verify-otp", {
        token,
        otp_code: otp.trim(),
      });
      sessionStorage.setItem("enrollment_verified", token);
      setPage((prev) => {
        const school = res.data.school;
        const submissionsCount = prev.state === "otp" ? 0 : 0;
        return { state: "form", school, submissionsCount, maxSubmissions: 4 };
      });
      // re-fetch to get correct counts
      const tokenRes = await axios.get<{ submissionsCount: number; maxSubmissions: number; school: SchoolInfo }>(
        `/api/enrollment/verify-token/${token}`
      );
      setPage({ state: "form", school: tokenRes.data.school, submissionsCount: tokenRes.data.submissionsCount, maxSubmissions: tokenRes.data.maxSubmissions });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setOtpError(err.response?.data?.error ?? "رمز التحقق غير صحيح");
      } else {
        setOtpError("حدث خطأ. حاول مرة أخرى.");
      }
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    setResending(true);
    try {
      await axios.post("/api/enrollment/resend-otp", { token });
      setOtp("");
      setOtpError(null);
      startResendTimer();
    } catch {
      /* silent */
    } finally {
      setResending(false);
    }
  }

  function handleFormSuccess(childName: string, newCount: number, guardian: GuardianPrefill) {
    setGuardianPrefill(guardian);
    const school = page.state === "form" ? page.school : { name: "", logoUrl: null };
    const max = page.state === "form" ? page.maxSubmissions : 4;
    setPage({ state: "done", childName, school, submissionsCount: newCount, maxSubmissions: max });
  }

  function handleAddSibling() {
    if (page.state !== "done") return;
    setPage({ state: "form", school: page.school, submissionsCount: page.submissionsCount, maxSubmissions: page.maxSubmissions });
  }

  // ── Render ──

  if (page.state === "loading") {
    return (
      <div dir="rtl" className="min-h-screen bg-gradient-to-b from-[#f0fdf4] to-[#f4f6fb] flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-gray-200 border-t-[#22c55e] rounded-full animate-spin" />
      </div>
    );
  }

  if (page.state === "expired") {
    return (
      <div dir="rtl" className="min-h-screen bg-gradient-to-b from-[#f0fdf4] to-[#f4f6fb] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⏰</span>
          </div>
          <h2 className="text-lg font-bold text-[#1a2340] mb-2">انتهت صلاحية الرابط</h2>
          <p className="text-sm text-gray-500">انتهت صلاحية هذا الرابط. يرجى التواصل مع الحضانة للحصول على رابط جديد.</p>
        </div>
      </div>
    );
  }

  if (page.state === "limit_reached") {
    return (
      <div dir="rtl" className="min-h-screen bg-gradient-to-b from-[#f0fdf4] to-[#f4f6fb] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🚫</span>
          </div>
          <h2 className="text-lg font-bold text-[#1a2340] mb-2">تم الوصول للحد الأقصى</h2>
          <p className="text-sm text-gray-500">
            لقد وصلت إلى الحد الأقصى المسموح به ({page.max} أطفال). يرجى التواصل مع إدارة الحضانة للحصول على رابط جديد.
          </p>
        </div>
      </div>
    );
  }

  const school = page.state === "otp" || page.state === "form" || page.state === "done" ? page.school : { name: "", logoUrl: null };
  const step: 1 | 2 | 3 = page.state === "otp" ? 1 : page.state === "form" ? 2 : 3;

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-b from-[#f0fdf4] to-[#f4f6fb]">
      <div className="max-w-lg mx-auto px-4 py-8">
        <SchoolHeader school={school} />
        <ProgressBar step={step} />

        {page.state === "otp" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-bold text-[#1a2340] text-center mb-2">أدخل رمز التحقق</h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              تم إرسال رمز مكون من 6 أرقام إلى
              <br />
              <span dir="ltr" className="font-mono font-medium text-[#1a2340]">{page.maskedPhone}</span>
            </p>

            <div className="mb-6">
              <OtpInput value={otp} onChange={setOtp} />
            </div>

            {otpError && (
              <p className="text-sm text-red-600 text-center mb-4">{otpError}</p>
            )}

            <button
              onClick={handleVerifyOtp}
              disabled={verifying}
              className="w-full py-4 bg-[#22c55e] text-white rounded-2xl font-bold text-base hover:bg-[#16a34a] transition-colors disabled:opacity-50 mb-4 min-h-[56px]"
            >
              {verifying ? "جاري التحقق..." : "تحقق"}
            </button>

            <div className="text-center">
              {resendTimer > 0 ? (
                <p className="text-sm text-gray-400">
                  لم تستلم الرمز؟ إعادة الإرسال بعد <span className="font-mono font-medium">{resendTimer}ث</span>
                </p>
              ) : (
                <button
                  onClick={handleResend}
                  disabled={resending}
                  className="text-sm text-[#22c55e] font-medium hover:underline disabled:opacity-50"
                >
                  {resending ? "جاري الإرسال..." : "إعادة إرسال الرمز"}
                </button>
              )}
            </div>
          </div>
        )}

        {page.state === "form" && (
          <EnrollmentForm
            token={token}
            school={page.school}
            initialGuardian={guardianPrefill}
            submissionsCount={page.submissionsCount}
            maxSubmissions={page.maxSubmissions}
            onSuccess={handleFormSuccess}
          />
        )}

        {page.state === "done" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-xl font-bold text-[#1a2340] mb-2">تم استلام طلب التسجيل بنجاح</h2>
            <p className="text-sm text-gray-600 mb-1">
              تم استلام طلب تسجيل <span className="font-semibold">{page.childName}</span>
            </p>
            <p className="text-sm text-gray-500 mb-8">
              ستتواصل معك إدارة <span className="font-semibold">{page.school.name}</span> قريباً
            </p>

            <div className="h-px bg-gray-100 mb-6" />

            {page.submissionsCount < page.maxSubmissions ? (
              <>
                <p className="text-sm text-gray-500 mb-4">هل لديك طفل آخر تريد تسجيله؟</p>
                <button
                  onClick={handleAddSibling}
                  className="w-full py-4 border-2 border-[#22c55e] text-[#22c55e] rounded-2xl font-bold text-base hover:bg-green-50 transition-colors min-h-[56px]"
                >
                  تسجيل طفل آخر
                </button>
                <p className="text-xs text-gray-400 mt-2">
                  متبقي {page.maxSubmissions - page.submissionsCount} طلب من أصل {page.maxSubmissions}
                </p>
              </>
            ) : (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl text-sm text-orange-700">
                لقد وصلت إلى الحد الأقصى المسموح به ({page.maxSubmissions} أطفال). يرجى التواصل مع إدارة الحضانة للحصول على رابط جديد.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
