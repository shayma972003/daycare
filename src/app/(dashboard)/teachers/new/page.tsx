"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { t } from "@/lib/utils";

type Class = { id: string; name: string };

type TeacherFormData = {
  name: string;
  period: "MORNING" | "EVENING";
  classId: string;
  idNumber: string;
  dateOfBirth: string;
  nationality: string;
  email: string;
  phone1: string;
  phone2: string;
  qualification1: string;
  qualification2: string;
  qualification3: string;
  paymentMethod: "CASH" | "TRANSFER" | "CARD";
  joinDate: string;
  enrollmentEndDate: string;
  monthlySalary: number;
  lateDeductionRate: number;
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

export default function NewTeacherPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<Class[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<TeacherFormData>({
    defaultValues: {
      period: "MORNING",
      paymentMethod: "CASH",
      joinDate: new Date().toISOString().slice(0, 10),
      monthlySalary: 0,
      lateDeductionRate: 0,
    },
  });

  const period = watch("period");

  useEffect(() => {
    axios
      .get<Class[]>("/api/classes", { params: period ? { period } : {} })
      .then((r) => setClasses(r.data))
      .catch(() => {});
  }, [period]);

  async function onSubmit(data: TeacherFormData) {
    setSaving(true);
    setError(null);
    try {
      await axios.post("/api/teachers", {
        ...data,
        dateOfBirth: data.dateOfBirth || undefined,
        enrollmentEndDate: data.enrollmentEndDate || undefined,
        classId: data.classId || undefined,
        monthlySalary: Number(data.monthlySalary),
        lateDeductionRate: Number(data.lateDeductionRate),
      });
      router.push("/teachers");
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? t("common.error") : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title="إضافة معلم جديد" />
      <div className="p-6">
        <button
          onClick={() => router.push("/teachers")}
          className="mb-4 text-sm text-[#111111] hover:underline flex items-center gap-1"
        >
          ← {t("teachers.title")}
        </button>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-base font-bold text-[#111111] mb-5">بيانات المعلم</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

              <Field label="الاسم الكامل">
                <input {...register("name", { required: true })} type="text" className={`${inputCls} ${errors.name ? "border-red-400" : ""}`} />
              </Field>

              <Field label={t("teachers.columns.period")}>
                <select
                  {...register("period")}
                  className={inputCls}
                  onChange={(e) => {
                    register("period").onChange(e);
                    setValue("classId", "");
                  }}
                >
                  <option value="MORNING">{t("periods.MORNING")}</option>
                  <option value="EVENING">{t("periods.EVENING")}</option>
                </select>
              </Field>

              <Field label="الفصل">
                <select {...register("classId")} className={inputCls}>
                  <option value="">— {t("common.select")} —</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>

              <Field label="رقم الهوية / الإقامة">
                <input {...register("idNumber")} type="text" className={inputCls} />
              </Field>

              <Field label="تاريخ الميلاد">
                <input {...register("dateOfBirth")} type="date" dir="ltr" className={inputCls} />
              </Field>

              <Field label="الجنسية">
                <input {...register("nationality")} type="text" className={inputCls} />
              </Field>

              <Field label="البريد الإلكتروني">
                <input {...register("email")} type="email" dir="ltr" className={inputCls} />
              </Field>

              <Field label="الهاتف 1">
                <input {...register("phone1")} type="tel" dir="ltr" className={inputCls} />
              </Field>

              <Field label="الهاتف 2">
                <input {...register("phone2")} type="tel" dir="ltr" className={inputCls} />
              </Field>

              <Field label="المؤهل 1">
                <input {...register("qualification1")} type="text" className={inputCls} />
              </Field>

              <Field label="المؤهل 2">
                <input {...register("qualification2")} type="text" className={inputCls} />
              </Field>

              <Field label="المؤهل 3">
                <input {...register("qualification3")} type="text" className={inputCls} />
              </Field>

              <Field label="طريقة الدفع">
                <select {...register("paymentMethod")} className={inputCls}>
                  <option value="CASH">{t("paymentMethod.CASH")}</option>
                  <option value="TRANSFER">{t("paymentMethod.TRANSFER")}</option>
                  <option value="CARD">{t("paymentMethod.CARD")}</option>
                </select>
              </Field>

              <Field label="تاريخ الانضمام">
                <input {...register("joinDate")} type="date" dir="ltr" className={inputCls} />
              </Field>

              <Field label="تاريخ انتهاء العقد">
                <input {...register("enrollmentEndDate")} type="date" dir="ltr" className={inputCls} />
              </Field>

              <Field label="الراتب الشهري (ر.س)">
                <input {...register("monthlySalary")} type="number" min={0} step="0.01" className={inputCls} />
              </Field>

              <Field label="نسبة خصم التأخير (%)">
                <input {...register("lateDeductionRate")} type="number" min={0} step="0.01" className={inputCls} />
              </Field>

            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-8 py-2.5 bg-[#F64651] text-white rounded-xl text-sm font-bold hover:bg-[#D93A44] transition-colors disabled:opacity-60"
              >
                {saving ? t("common.loading") : "حفظ وإضافة المعلم"}
              </button>
              <button
                type="button"
                onClick={() => router.push("/teachers")}
                className="px-6 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
