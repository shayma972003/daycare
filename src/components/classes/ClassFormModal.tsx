"use client";

import { useEffect, useState, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import axios from "axios";
import { t } from "@/lib/utils";

interface Teacher {
  id: string;
  name: string;
}

export interface ClassData {
  id: string;
  name: string;
  teacherId?: string | null;
  teacher?: { id: string; name: string } | null;
  group?: string | null;
  period?: "MORNING" | "EVENING" | null;
  registrationDate?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
  students?: { id: string }[];
}

interface FormValues {
  name: string;
  teacherId: string;
  childrenCount: number;
  group: string;
  period: "MORNING" | "EVENING" | "";
  registrationDate: string;
  notes: string;
}

interface ClassFormModalProps {
  open: boolean;
  onClose: () => void;
  classData: ClassData | null;
  onSaved: () => void;
}

export function ClassFormModal({
  open,
  onClose,
  classData,
  onSaved,
}: ClassFormModalProps) {
  const isEditing = classData != null;
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      name: "",
      teacherId: "",
      childrenCount: 0,
      group: "",
      period: "",
      registrationDate: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    setLoadingTeachers(true);
    axios
      .get<Teacher[]>("/api/teachers")
      .then((res) => setTeachers(res.data))
      .catch(() => setTeachers([]))
      .finally(() => setLoadingTeachers(false));
  }, [open]);

  useEffect(() => {
    if (open && classData) {
      reset({
        name: classData.name ?? "",
        teacherId: classData.teacherId ?? "",
        childrenCount: classData.students?.length ?? 0,
        group: classData.group ?? "",
        period: (classData.period as "MORNING" | "EVENING") ?? "",
        registrationDate: classData.registrationDate
          ? classData.registrationDate.slice(0, 10)
          : "",
        notes: classData.notes ?? "",
      });
      setImageUrl(classData.imageUrl ?? null);
      setImagePreview(classData.imageUrl ?? null);
    } else if (open && !classData) {
      reset({ name: "", teacherId: "", childrenCount: 0, group: "", period: "", registrationDate: "", notes: "" });
      setImageUrl(null);
      setImagePreview(null);
    }
  }, [open, classData, reset]);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
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

  async function onSubmit(values: FormValues) {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: values.name,
        ...(values.teacherId && { teacherId: values.teacherId }),
        ...(values.group && { group: values.group }),
        ...(values.period && { period: values.period }),
        ...(values.registrationDate && { registrationDate: values.registrationDate }),
        ...(values.notes && { notes: values.notes }),
        imageUrl: imageUrl ?? undefined,
      };

      if (isEditing) {
        await axios.put(`/api/classes/${classData!.id}`, payload);
      } else {
        await axios.post("/api/classes", payload);
      }
      onSaved();
      onClose();
    } catch {
      setError(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function openDeleteConfirm() {
    if (!classData) return;
    setError(null);
    try {
      const res = await axios.get<{ count: number }>(`/api/classes/${classData.id}/students`);
      setEnrolledCount(res.data.count ?? 0);
    } catch {
      setEnrolledCount(0);
    }
    setConfirmDelete(true);
  }

  async function handleDelete() {
    if (!classData) return;
    setDeleting(true);
    setError(null);
    try {
      await axios.delete(`/api/classes/${classData.id}`);
      onSaved();
      onClose();
    } catch {
      setError(t("common.error"));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          dir="rtl"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
        >
          <Dialog.Title className="text-lg font-bold text-[#1a2340] mb-5">
            {t("classes.form.title")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            نافذة إضافة أو تعديل فصل دراسي
          </Dialog.Description>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Image upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t("classes.form.image")}
              </label>
              <div
                className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-[#22c55e] transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <img src={imagePreview} alt="معاينة" className="w-full h-32 object-cover" />
                ) : (
                  <div className="h-28 flex flex-col items-center justify-center gap-2 text-gray-400">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl">🖼</div>
                    <span className="text-xs">انقر لرفع صورة (jpg, png)</span>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png" className="hidden" onChange={handleImageChange} />
              {uploadingImage && <p className="text-xs text-gray-400 mt-1">جاري الرفع...</p>}
              {imagePreview && (
                <button type="button" onClick={() => { setImageUrl(null); setImagePreview(null); }} className="text-xs text-red-500 hover:underline mt-1">
                  حذف الصورة
                </button>
              )}
            </div>

            {/* Class name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.name")}</label>
              <input
                {...register("name", { required: true })}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm"
                placeholder={t("classes.form.name")}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">هذا الحقل مطلوب</p>}
            </div>

            {/* Teacher select */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.teacher")}</label>
              <select
                {...register("teacherId")}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm bg-white"
                disabled={loadingTeachers}
              >
                <option value="">{t("common.select")}</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                ))}
              </select>
            </div>

            {/* Children count */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.childrenCount")}</label>
              <input
                type="number"
                min={0}
                {...register("childrenCount", { valueAsNumber: true })}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm"
              />
            </div>

            {/* Group */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.group")}</label>
              <select
                {...register("group")}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm bg-white"
              >
                <option value="">{t("common.select")}</option>
                <option value="kg1">{t("groups.kg1")}</option>
                <option value="kg2">{t("groups.kg2")}</option>
                <option value="kg3">{t("groups.kg3")}</option>
                <option value="nursery">{t("groups.nursery")}</option>
              </select>
            </div>

            {/* Period */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.period")}</label>
              <select
                {...register("period")}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm bg-white"
              >
                <option value="">{t("common.select")}</option>
                <option value="MORNING">{t("periods.MORNING")}</option>
                <option value="EVENING">{t("periods.EVENING")}</option>
              </select>
            </div>

            {/* Registration date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.registrationDate")}</label>
              <input
                type="date"
                {...register("registrationDate")}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm"
                dir="ltr"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.notes")}</label>
              <textarea
                {...register("notes")}
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e] text-sm resize-none"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving || uploadingImage}
                className="flex-1 py-2.5 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60"
              >
                {saving ? t("common.loading") : t("classes.form.save")}
              </button>

              {isEditing && (
                <button
                  type="button"
                  onClick={openDeleteConfirm}
                  disabled={deleting}
                  className="border border-red-500 text-red-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-50 transition-all disabled:opacity-60"
                >
                  {deleting ? t("common.loading") : "نقل إلى سلة المحذوفات"}
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-all"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4" dir="rtl">
            {enrolledCount === 0 ? (
              <p className="text-sm font-medium text-[#1a2340]">
                هل تريد نقل هذا الفصل إلى سلة المحذوفات؟
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-[#1a2340]">
                  هذا الفصل يحتوي على {enrolledCount} طلاب.
                </p>
                <p className="text-sm text-gray-600 whitespace-pre-line">
                  {"عند الحذف سيبقى هؤلاء الطلاب بدون فصل محدد\nوسيظهر تنبيه عليهم حتى يتم التعيين."}
                </p>
              </>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {deleting ? "..." : "حذف"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </Dialog.Root>
  );
}
