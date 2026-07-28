"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import { useState } from "react";
import axios from "axios";
import { t } from "@/lib/utils";

type Class = { id: string; name: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  classes: Class[];
}

type FormData = {
  name: string;
  guardianName1: string;
  phone1: string;
  phone2: string;
  email: string;
  period: string;
  classId: string;
  gender: string;
  paymentMethod: string;
  dateOfBirth: string;
  nationality: string;
};

export function AddStudentModal({ open, onClose, onSaved, classes }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { register, handleSubmit, reset } = useForm<FormData>({
    defaultValues: {
      period: "MORNING",
      gender: "MALE",
      paymentMethod: "CASH",
    },
  });

  async function onSubmit(data: FormData) {
    setError("");
    setLoading(true);
    try {
      await axios.post("/api/students", {
        ...data,
        classId: data.classId || undefined,
        dateOfBirth: data.dateOfBirth || undefined,
      });
      reset();
      onSaved();
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          dir="rtl"
          className="fixed right-1/2 top-1/2 z-50 -translate-y-1/2 translate-x-1/2 w-full max-w-lg bg-white rounded-2xl shadow-modal p-6 max-h-[90vh] overflow-y-auto animate-scale-in"
        >
          <Dialog.Title className="text-lg font-bold text-[#111111] mb-5">
            {t("students.addStudent")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            نافذة إضافة طالب جديد
          </Dialog.Description>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.name")} *
                </label>
                <input
                  {...register("name", { required: true })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.guardianName")}
                </label>
                <input
                  {...register("guardianName1")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.phone1")}
                </label>
                <input
                  {...register("phone1")}
                  dir="ltr"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.phone2")}
                </label>
                <input
                  {...register("phone2")}
                  dir="ltr"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.email")}
                </label>
                <input
                  {...register("email")}
                  type="email"
                  dir="ltr"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.period")}
                </label>
                <select
                  {...register("period")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                >
                  <option value="MORNING">{t("periods.MORNING")}</option>
                  <option value="EVENING">{t("periods.EVENING")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.class")}
                </label>
                <select
                  {...register("classId")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                >
                  <option value="">— {t("common.select")} —</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.gender")}
                </label>
                <select
                  {...register("gender")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                >
                  <option value="MALE">{t("gender.MALE")}</option>
                  <option value="FEMALE">{t("gender.FEMALE")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.paymentMethod")}
                </label>
                <select
                  {...register("paymentMethod")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                >
                  <option value="CASH">{t("paymentMethod.CASH")}</option>
                  <option value="TRANSFER">{t("paymentMethod.TRANSFER")}</option>
                  <option value="CARD">{t("paymentMethod.CARD")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.dateOfBirth")}
                </label>
                <input
                  {...register("dateOfBirth")}
                  type="date"
                  dir="ltr"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("students.profile.nationality")}
                </label>
                <input
                  {...register("nationality")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 bg-[#F64651] text-white rounded-lg text-sm font-medium hover:bg-[#D93A44] disabled:opacity-60 transition-colors"
              >
                {loading ? t("common.loading") : t("common.add")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
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
