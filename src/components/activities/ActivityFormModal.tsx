"use client";

import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";
import * as Dialog from "@radix-ui/react-dialog";
import { t } from "@/lib/utils";
import { VariableReference } from "@/components/ui/VariableReference";
import type { Activity } from "./ActivityGrid";

interface Teacher {
  id: string;
  name: string;
}

interface ClassItem {
  id: string;
  name: string;
}

interface ActivityFormValues {
  name: string;
  teacherId: string;
  childrenCount: number;
  group: "kg1" | "kg2" | "kg3" | "nursery";
  period: "MORNING" | "EVENING";
  startDate: string;
  endDate: string;
  fee: number;
  message: string;
  classIds: string[];
}

interface ActivityFormModalProps {
  open: boolean;
  onClose: () => void;
  activity: Activity | null;
  onSaved: () => void;
}

export function ActivityFormModal({
  open,
  onClose,
  activity,
  onSaved,
}: ActivityFormModalProps) {
  const isEdit = !!activity;

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ActivityFormValues>({
    defaultValues: {
      name: "",
      teacherId: "",
      childrenCount: 0,
      group: "kg1",
      period: "MORNING",
      startDate: "",
      endDate: "",
      fee: 0,
      message: "",
      classIds: [],
    },
  });

  const selectedClassIds = watch("classIds") ?? [];

  useEffect(() => {
    if (!open) return;

    setLoadingTeachers(true);
    axios
      .get<Teacher[]>("/api/teachers")
      .then((r) => setTeachers(r.data))
      .catch(() => setTeachers([]))
      .finally(() => setLoadingTeachers(false));

    setLoadingClasses(true);
    axios
      .get<ClassItem[]>("/api/classes")
      .then((r) => setClasses(r.data))
      .catch(() => setClasses([]))
      .finally(() => setLoadingClasses(false));
  }, [open]);

  useEffect(() => {
    if (open && activity) {
      reset({
        name: activity.name ?? "",
        teacherId: "",
        childrenCount: activity.childrenCount ?? 0,
        group: activity.group ?? "kg1",
        period: activity.period ?? "MORNING",
        startDate: activity.startDate ? activity.startDate.slice(0, 10) : "",
        endDate: activity.endDate ? activity.endDate.slice(0, 10) : "",
        fee: activity.fee ?? 0,
        message: activity.message ?? "",
        classIds: [],
      });
      setImageUrl(activity.imageUrl ?? null);
      setImagePreview(activity.imageUrl ?? null);
    } else if (open && !activity) {
      reset({
        name: "",
        teacherId: "",
        childrenCount: 0,
        group: "kg1",
        period: "MORNING",
        startDate: "",
        endDate: "",
        fee: 0,
        message: "",
        classIds: [],
      });
      setImageUrl(null);
      setImagePreview(null);
    }
    setError(null);
  }, [open, activity, reset]);

  const toggleClass = (id: string) => {
    const current = selectedClassIds.includes(id)
      ? selectedClassIds.filter((c) => c !== id)
      : [...selectedClassIds, id];
    setValue("classIds", current);
  };

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload to server
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post<{ url: string }>("/api/upload", fd);
      setImageUrl(res.data.url);
    } catch {
      setError("فشل رفع الصورة");
    } finally {
      setUploadingImage(false);
    }
  }

  const onSubmit = async (data: ActivityFormValues) => {
    setSaving(true);
    setError(null);
    try {
      const payload = { ...data, imageUrl };
      if (isEdit && activity) {
        await axios.put(`/api/activities/${activity.id}`, payload);
        await axios.post(`/api/activities/${activity.id}/send`);
      } else {
        await axios.post("/api/activities", payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? err.response.data.error
          : t("common.error");
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!activity) return;
    setDeleting(true);
    setError(null);
    try {
      await axios.delete(`/api/activities/${activity.id}`);
      onSaved();
      onClose();
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? err.response.data.error
          : t("common.error");
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          dir="rtl"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 focus:outline-none"
        >
          <Dialog.Description className="sr-only">
            نافذة إضافة أو تعديل نشاط
          </Dialog.Description>
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-lg font-bold text-[#1a2340]">
              {t("home.activityForm.title")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
                ×
              </button>
            </Dialog.Close>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Activity name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("home.activityForm.name")}
              </label>
              <input
                type="text"
                {...register("name", { required: true })}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e] ${
                  errors.name ? "border-red-400" : "border-gray-200"
                }`}
              />
            </div>

            {/* Teacher */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("home.activityForm.teacher")}
              </label>
              {loadingTeachers ? (
                <div className="text-xs text-gray-400">{t("common.loading")}</div>
              ) : (
                <select
                  {...register("teacherId", { required: true })}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e] ${
                    errors.teacherId ? "border-red-400" : "border-gray-200"
                  }`}
                >
                  <option value="">{t("common.select")}</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Children count + Group row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.childrenCount")}
                </label>
                <input
                  type="number"
                  min={0}
                  {...register("childrenCount", { valueAsNumber: true })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.group")}
                </label>
                <select
                  {...register("group")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
                >
                  <option value="kg1">{t("groups.kg1")}</option>
                  <option value="kg2">{t("groups.kg2")}</option>
                  <option value="kg3">{t("groups.kg3")}</option>
                  <option value="nursery">{t("groups.nursery")}</option>
                </select>
              </div>
            </div>

            {/* Period */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("home.activityForm.period")}
              </label>
              <select
                {...register("period")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
              >
                <option value="MORNING">{t("periods.MORNING")}</option>
                <option value="EVENING">{t("periods.EVENING")}</option>
              </select>
            </div>

            {/* Start + End dates row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.startDate")}
                </label>
                <input
                  type="date"
                  {...register("startDate", { required: true })}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e] ${errors.startDate ? "border-red-400" : "border-gray-200"}`}
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.endDate")}
                </label>
                <input
                  type="date"
                  {...register("endDate", { required: true })}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e] ${errors.endDate ? "border-red-400" : "border-gray-200"}`}
                  dir="ltr"
                />
              </div>
            </div>

            {/* Fee */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("home.activityForm.fee")}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  {...register("fee", { valueAsNumber: true })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e] pl-12"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                  {t("common.sar")}
                </span>
              </div>
            </div>

            {/* Image upload with preview */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("home.activityForm.image")}
              </label>
              <div
                className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-[#22c55e] transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt="معاينة"
                    className="w-full h-40 object-cover"
                  />
                ) : (
                  <div className="h-32 flex flex-col items-center justify-center gap-2 text-gray-400">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl">
                      🖼
                    </div>
                    <span className="text-xs">انقر لرفع صورة (jpg, png)</span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png"
                className="hidden"
                onChange={handleImageChange}
              />
              {uploadingImage && (
                <p className="text-xs text-gray-400 mt-1">جاري الرفع...</p>
              )}
              {imagePreview && (
                <button
                  type="button"
                  onClick={() => { setImageUrl(null); setImagePreview(null); }}
                  className="text-xs text-red-500 hover:underline mt-1"
                >
                  حذف الصورة
                </button>
              )}
            </div>

            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("home.activityForm.message")}
              </label>
              <textarea
                {...register("message")}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e] resize-none"
              />
              <VariableReference mode="full" />
            </div>

            {/* Classes checklist */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("home.activityForm.classes")}
              </label>
              {loadingClasses ? (
                <div className="text-xs text-gray-400">{t("common.loading")}</div>
              ) : classes.length === 0 ? (
                <div className="text-xs text-gray-400">{t("common.noData")}</div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border border-gray-100 rounded-lg">
                  {classes.map((cls) => (
                    <label
                      key={cls.id}
                      className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedClassIds.includes(cls.id)}
                        onChange={() => toggleClass(cls.id)}
                        className="accent-[#22c55e]"
                      />
                      {cls.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <button
                type="submit"
                disabled={saving || uploadingImage}
                className="flex-1 bg-[#22c55e] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#16a34a] transition-colors disabled:opacity-60"
              >
                {saving ? t("common.loading") : t("home.activityForm.saveAndSend")}
              </button>

              {isEdit && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2.5 border border-red-500 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-60"
                >
                  {deleting ? t("common.loading") : t("home.activityForm.deleteActivity")}
                </button>
              )}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
