"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import axios from "axios";
import { useState } from "react";
import { t } from "@/lib/utils";

interface FormValues {
  name: string;
  phone1: string;
  phone2: string;
  email: string;
  period: "MORNING" | "EVENING" | "";
  monthlySalary: number;
  lateDeductionRate: number;
  paymentMethod: "CASH" | "TRANSFER" | "CARD" | "";
  joinDate: string;
  nationality: string;
}

interface AddTeacherModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AddTeacherModal({ open, onClose, onSaved }: AddTeacherModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      name: "",
      phone1: "",
      phone2: "",
      email: "",
      period: "",
      monthlySalary: 0,
      lateDeductionRate: 0,
      paymentMethod: "",
      joinDate: "",
      nationality: "",
    },
  });

  async function onSubmit(values: FormValues) {
    setSaving(true);
    setError(null);
    try {
      await axios.post("/api/teachers", {
        name: values.name,
        ...(values.phone1 && { phone1: values.phone1 }),
        ...(values.phone2 && { phone2: values.phone2 }),
        ...(values.email && { email: values.email }),
        ...(values.period && { period: values.period }),
        ...(values.monthlySalary && { monthlySalary: Number(values.monthlySalary) }),
        ...(values.lateDeductionRate && { lateDeductionRate: Number(values.lateDeductionRate) }),
        ...(values.paymentMethod && { paymentMethod: values.paymentMethod }),
        ...(values.joinDate && { joinDate: values.joinDate }),
        ...(values.nationality && { nationality: values.nationality }),
      });
      reset();
      onSaved();
      onClose();
    } catch {
      setError(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    reset();
    setError(null);
    onClose();
  }

  const inputCls =
    "w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm";
  const selectCls =
    "w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm bg-white";
  const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-white rounded-2xl shadow-modal p-6 max-h-[90vh] overflow-y-auto animate-scale-in">
          <Dialog.Title className="text-lg font-bold text-[#1a2340] mb-5">
            {t("teachers.addTeacher")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            نافذة إضافة معلم جديد
          </Dialog.Description>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Name */}
            <div>
              <label className={labelCls}>{t("teachers.profile.name")}</label>
              <input
                {...register("name", { required: true })}
                className={inputCls}
                placeholder={t("teachers.profile.name")}
              />
              {errors.name && (
                <p className="text-xs text-red-500 mt-1">هذا الحقل مطلوب</p>
              )}
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

            {/* Nationality */}
            <div>
              <label className={labelCls}>{t("teachers.profile.nationality")}</label>
              <input
                {...register("nationality")}
                className={inputCls}
                placeholder={t("teachers.profile.nationality")}
              />
            </div>

            {/* Phone 1 */}
            <div>
              <label className={labelCls}>{t("teachers.profile.phone1")}</label>
              <input
                {...register("phone1")}
                className={inputCls}
                placeholder="05XXXXXXXX"
                dir="ltr"
              />
            </div>

            {/* Phone 2 */}
            <div>
              <label className={labelCls}>{t("teachers.profile.phone2")}</label>
              <input
                {...register("phone2")}
                className={inputCls}
                placeholder="05XXXXXXXX"
                dir="ltr"
              />
            </div>

            {/* Email */}
            <div>
              <label className={labelCls}>{t("teachers.profile.email")}</label>
              <input
                {...register("email")}
                type="email"
                className={inputCls}
                placeholder="name@example.com"
                dir="ltr"
              />
            </div>

            {/* Monthly salary */}
            <div>
              <label className={labelCls}>{t("teachers.profile.monthlySalary")}</label>
              <input
                type="number"
                min={0}
                {...register("monthlySalary", { valueAsNumber: true })}
                className={inputCls}
              />
            </div>

            {/* Late deduction rate */}
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

            {/* Payment method */}
            <div>
              <label className={labelCls}>{t("teachers.profile.paymentMethod")}</label>
              <select {...register("paymentMethod")} className={selectCls}>
                <option value="">{t("common.select")}</option>
                <option value="CASH">{t("paymentMethod.CASH")}</option>
                <option value="TRANSFER">{t("paymentMethod.TRANSFER")}</option>
                <option value="CARD">{t("paymentMethod.CARD")}</option>
              </select>
            </div>

            {/* Join date */}
            <div>
              <label className={labelCls}>{t("teachers.profile.joinDate")}</label>
              <input
                type="date"
                {...register("joinDate")}
                className={inputCls}
                dir="ltr"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
                {error}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2.5 bg-[#F64651] hover:bg-[#D93A44] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60"
              >
                {saving ? t("common.loading") : t("common.save")}
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-all"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
