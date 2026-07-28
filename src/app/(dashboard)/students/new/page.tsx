"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { t } from "@/lib/utils";

type Class = { id: string; name: string };
type GuardianSuggestion = { id: string; name: string; phone1?: string | null; phone2?: string | null; email?: string | null; name_2?: string | null; phone_3?: string | null; phone_4?: string | null; email_2?: string | null };

type StudentFormData = {
  name: string;
  healthCondition: string;
  academicStage: string;
  period: "MORNING" | "EVENING";
  classId: string;
  idNumber: string;
  dateOfBirth: string;
  nationality: string;
  gender: "MALE" | "FEMALE";
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
  paymentMethod: "CASH" | "TRANSFER" | "CARD";
  paymentStatus: "PAID" | "LATE" | "CANCELLED" | "SUSPENDED";
  enrollmentEndDate: string;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]";

export default function NewStudentPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<Class[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardianId, setGuardianId] = useState<string | null>(null);
  const [guardianLinked, setGuardianLinked] = useState(false);
  const [suggestions, setSuggestions] = useState<GuardianSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<StudentFormData>({
    defaultValues: {
      gender: "MALE",
      period: "MORNING",
      paymentMethod: "CASH",
      paymentStatus: "PAID",
    },
  });

  useEffect(() => {
    axios.get<Class[]>("/api/classes").then((r) => setClasses(r.data)).catch(() => {});
  }, []);

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
    setValue("guardianName", g.name);
    setValue("guardianPhone1", g.phone1 ?? "");
    setValue("guardianPhone2", g.phone2 ?? "");
    setValue("guardianEmail", g.email ?? "");
    setValue("guardianName2", g.name_2 ?? "");
    setValue("guardianPhone3", g.phone_3 ?? "");
    setValue("guardianPhone4", g.phone_4 ?? "");
    setValue("guardianEmail2", g.email_2 ?? "");
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function onSubmit(data: StudentFormData) {
    setSaving(true);
    setError(null);
    try {
      await axios.post("/api/students", {
        name: data.name,
        classId: data.classId || undefined,
        healthCondition: data.healthCondition || undefined,
        academicStage: data.academicStage || undefined,
        period: data.period,
        idNumber: data.idNumber || undefined,
        dateOfBirth: data.dateOfBirth || undefined,
        nationality: data.nationality || undefined,
        gender: data.gender,
        allergies: data.allergies || undefined,
        paymentMethod: data.paymentMethod,
        paymentStatus: data.paymentStatus,
        enrollmentEndDate: data.enrollmentEndDate || undefined,
        guardianId: guardianId || undefined,
        guardianName: data.guardianName || undefined,
        guardianPhone1: data.guardianPhone1 || undefined,
        guardianPhone2: data.guardianPhone2 || undefined,
        guardianEmail: data.guardianEmail || undefined,
        guardianName2: data.guardianName2 || undefined,
        guardianPhone3: data.guardianPhone3 || undefined,
        guardianPhone4: data.guardianPhone4 || undefined,
        guardianEmail2: data.guardianEmail2 || undefined,
        registration_fee: parseFloat(data.registrationFee) || 0,
      });
      router.push("/students");
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? t("common.error") : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  const guardianName = watch("guardianName");

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title="إضافة طالب جديد" />
      <div className="p-6">
        <button
          onClick={() => router.push("/students")}
          className="mb-4 text-sm text-[#111111] hover:underline flex items-center gap-1"
        >
          ← {t("students.title")}
        </button>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Card 1: معلومات الطالب */}
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-base font-bold text-[#111111] mb-5">معلومات الطالب</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label={t("students.profile.name")}>
                <input {...register("name", { required: true })} type="text" className={`${inputCls} ${errors.name ? "border-red-400" : ""}`} />
              </Field>
              <Field label={t("students.profile.gender")}>
                <select {...register("gender")} className={inputCls}>
                  <option value="MALE">{t("gender.MALE")}</option>
                  <option value="FEMALE">{t("gender.FEMALE")}</option>
                </select>
              </Field>
              <Field label={t("students.profile.dateOfBirth")}>
                <input {...register("dateOfBirth")} type="date" dir="ltr" className={inputCls} />
              </Field>
              <Field label={t("students.profile.nationality")}>
                <input {...register("nationality")} type="text" className={inputCls} />
              </Field>
              <Field label={t("students.profile.idNumber")}>
                <input {...register("idNumber")} type="text" className={inputCls} />
              </Field>
              <Field label={t("students.profile.academicStage")}>
                <input {...register("academicStage")} type="text" className={inputCls} />
              </Field>
              <Field label={t("students.profile.period")}>
                <select {...register("period")} className={inputCls}>
                  <option value="MORNING">{t("periods.MORNING")}</option>
                  <option value="EVENING">{t("periods.EVENING")}</option>
                </select>
              </Field>
              <Field label={t("students.profile.class")}>
                <select {...register("classId")} className={inputCls}>
                  <option value="">— {t("common.select")} —</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* Card 2: المعلومات الصحية */}
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-base font-bold text-[#111111] mb-5">المعلومات الصحية</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t("students.profile.healthCondition")}>
                <input {...register("healthCondition")} type="text" className={inputCls} />
              </Field>
              <Field label={t("students.profile.allergies")}>
                <input {...register("allergies")} type="text" className={inputCls} />
              </Field>
            </div>
          </div>

          {/* Card 3: معلومات ولي الأمر */}
          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-[#111111]">معلومات ولي الأمر</h2>
              {guardianLinked && (
                <span className="text-xs bg-success-bg text-success-text border border-success-text/20 px-3 py-1 rounded-full font-medium">
                  تم ربط ولي الأمر الموجود
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="relative">
                <Field label={t("students.profile.guardianName")}>
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
                </Field>
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
                        <div className="font-medium text-[#111111]">{g.name}</div>
                        <div className="text-xs text-gray-400">{[g.phone1, g.email].filter(Boolean).join(" · ")}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Field label={t("students.profile.phone1")}>
                <input
                  {...register("guardianPhone1")}
                  type="tel"
                  dir="ltr"
                  className={inputCls}
                  onChange={(e) => {
                    register("guardianPhone1").onChange(e);
                    if (!guardianName) handleGuardianFieldChange(e.target.value);
                  }}
                />
              </Field>
              <Field label={t("students.profile.phone2")}>
                <input {...register("guardianPhone2")} type="tel" dir="ltr" className={inputCls} />
              </Field>
              <Field label={t("students.profile.email")}>
                <input
                  {...register("guardianEmail")}
                  type="email"
                  dir="ltr"
                  className={inputCls}
                  onChange={(e) => {
                    register("guardianEmail").onChange(e);
                    if (!guardianName) handleGuardianFieldChange(e.target.value);
                  }}
                />
              </Field>
              <Field label="اسم ولي الأمر 2">
                <input {...register("guardianName2")} type="text" className={inputCls}
                  onChange={(e) => { register("guardianName2").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
              </Field>
              <Field label="رقم الجوال 3">
                <input {...register("guardianPhone3")} type="tel" dir="ltr" className={inputCls}
                  onChange={(e) => { register("guardianPhone3").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
              </Field>
              <Field label="رقم الجوال 4">
                <input {...register("guardianPhone4")} type="tel" dir="ltr" className={inputCls}
                  onChange={(e) => { register("guardianPhone4").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
              </Field>
              <Field label="البريد الإلكتروني 2">
                <input {...register("guardianEmail2")} type="email" dir="ltr" className={inputCls}
                  onChange={(e) => { register("guardianEmail2").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
              </Field>
            </div>
          </div>

          {/* Card 4: معلومات التسجيل */}
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-base font-bold text-[#111111] mb-5">معلومات التسجيل</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label={t("students.profile.paymentMethod")}>
                <select {...register("paymentMethod")} className={inputCls}>
                  <option value="CASH">{t("paymentMethod.CASH")}</option>
                  <option value="TRANSFER">{t("paymentMethod.TRANSFER")}</option>
                  <option value="CARD">{t("paymentMethod.CARD")}</option>
                </select>
              </Field>
              <Field label="حالة الدفع">
                <select {...register("paymentStatus")} className={inputCls}>
                  <option value="PAID">{t("paymentStatus.PAID")}</option>
                  <option value="LATE">{t("paymentStatus.LATE")}</option>
                  <option value="CANCELLED">{t("paymentStatus.CANCELLED")}</option>
                  <option value="SUSPENDED">{t("paymentStatus.SUSPENDED")}</option>
                </select>
              </Field>
              <Field label={t("students.profile.enrollmentEndDate")}>
                <input {...register("enrollmentEndDate")} type="date" dir="ltr" className={inputCls} />
              </Field>
              <Field label="رسوم التسجيل">
                <div className="relative">
                  <input {...register("registrationFee")} type="number" min="0" step="0.01" dir="ltr" className={`${inputCls} pl-14`} />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">ر.س</span>
                </div>
              </Field>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-8 py-2.5 bg-[#F64651] text-white rounded-xl text-sm font-bold hover:bg-[#D93A44] transition-colors disabled:opacity-60"
            >
              {saving ? t("common.loading") : "حفظ وإضافة الطالب"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/students")}
              className="px-6 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
