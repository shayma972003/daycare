"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { teacherFormSchema } from "@/lib/form-schemas";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { useT } from "@/lib/i18n-provider";
import { FormErrors, collectMessages } from "@/components/ui/FormErrors";


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
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const router = useRouter();
  const [classes, setClasses] = useState<Class[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared schema — see the note on the student form and task 2.41.
  /* A blocked submit used to do nothing and say nothing — see FormErrors. */
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  function onInvalid(fieldErrors: unknown) {
    setInvalidFields(collectMessages(fieldErrors));
  }

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<TeacherFormData>({
    resolver: zodResolver(teacherFormSchema) as Resolver<TeacherFormData>,
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
      <Topbar title={t("teachers.addNew")} />
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

        <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-base font-bold text-[#111111] mb-5">{t("teachers.data")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

              <Field label={t("fields.fullName")}>
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

              <Field label={t("fields.classroom")}>
                <select {...register("classId")} className={inputCls}>
                  <option value="">— {t("common.select")} —</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>

              <Field label={t("teachers.nationalId")}>
                <input {...register("idNumber")} type="text" className={inputCls} />
              </Field>

              <Field label={t("fields.dateOfBirth")}>
                <input {...register("dateOfBirth")} type="date" dir="ltr" className={inputCls} />
              </Field>

              <Field label={t("fields.nationality")}>
                <input {...register("nationality")} type="text" className={inputCls} />
              </Field>

              <Field label={t("fields.email")}>
                <input {...register("email")} type="email" dir="ltr" className={inputCls} />
              </Field>

              <Field label={t("fields.tel1")}>
                <input {...register("phone1")} type="tel" dir="ltr" className={inputCls} />
              </Field>

              <Field label={t("fields.tel2")}>
                <input {...register("phone2")} type="tel" dir="ltr" className={inputCls} />
              </Field>

              <Field label={t("fields.qualification1")}>
                <input {...register("qualification1")} type="text" className={inputCls} />
              </Field>

              <Field label={t("fields.qualification2")}>
                <input {...register("qualification2")} type="text" className={inputCls} />
              </Field>

              <Field label={t("fields.qualification3")}>
                <input {...register("qualification3")} type="text" className={inputCls} />
              </Field>

              <Field label={t("fields.paymentMethod")}>
                <select {...register("paymentMethod")} className={inputCls}>
                  <option value="CASH">{t("paymentMethod.CASH")}</option>
                  <option value="TRANSFER">{t("paymentMethod.TRANSFER")}</option>
                  <option value="CARD">{t("paymentMethod.CARD")}</option>
                </select>
              </Field>

              <Field label={t("teachers.joinDate")}>
                <input {...register("joinDate")} type="date" dir="ltr" className={inputCls} />
              </Field>

              <Field label={t("teachers.contractEnd")}>
                <input {...register("enrollmentEndDate")} type="date" dir="ltr" className={inputCls} />
              </Field>

              <Field label={t("fields.salarySar")}>
                <input {...register("monthlySalary")} type="number" min={0} step="0.01" className={inputCls} />
              </Field>

              <Field label={t("teachers.lateDeductionRate")}>
                <input {...register("lateDeductionRate")} type="number" min={0} step="0.01" className={inputCls} />
              </Field>

            </div>

            <div className="mt-6 flex gap-3">
              <FormErrors messages={invalidFields} />
              <button
                type="submit"
                disabled={saving}
                className="px-8 py-2.5 bg-[#F64651] text-white rounded-xl text-sm font-bold hover:bg-[#D93A44] transition-colors disabled:opacity-60"
              >
                {saving ? t("common.loading") : t("teachers.saveAndAdd")}
              </button>
              <button
                type="button"
                onClick={() => router.push("/teachers")}
                className="px-6 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
