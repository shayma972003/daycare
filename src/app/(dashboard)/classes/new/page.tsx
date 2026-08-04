"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { useT } from "@/lib/i18n-provider";
import { useAcademicStages, useStageName } from "@/lib/use-academic-stages";


type Teacher = { id: string; name: string };

export default function NewClassPage() {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const { stages } = useAcademicStages();
  const stageName = useStageName();
  const router = useRouter();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    teacherId: "",
    stageId: "",
    period: "" as "" | "MORNING" | "EVENING",
    registrationDate: "",
    notes: "",
  });

  useEffect(() => {
    axios
      .get<Teacher[]>("/api/teachers", { params: form.period ? { period: form.period } : {} })
      .then((res) => setTeachers(res.data))
      .catch(() => setTeachers([]));
  }, [form.period]);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setImageError("حجم الملف كبير جدا، الحجم المسموح للملف هو 100 MB أو أقل");
      e.target.value = "";
      return;
    }
    setImageError("");
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

  async function handleSave() {
    if (!form.name.trim()) {
      setError("هذا الحقل مطلوب");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await axios.post<{ id: string }>("/api/classes", {
        name: form.name,
        ...(form.teacherId && { teacherId: form.teacherId }),
        ...(form.stageId && { stageId: form.stageId }),
        ...(form.period && { period: form.period }),
        ...(form.registrationDate && { registrationDate: form.registrationDate }),
        ...(form.notes && { notes: form.notes }),
        imageUrl: imageUrl ?? undefined,
      });
      router.push(`/classes/${res.data.id}`);
    } catch {
      setError(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={t("classes.addClass")} />
      <div className="p-6 space-y-5 max-w-2xl">
        <button
          onClick={() => router.push("/classes")}
          className="text-sm text-[#111111] hover:underline flex items-center gap-1"
        >
          ← {t("classes.title")}
        </button>

        <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
          {/* Image upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t("classes.form.image")}
            </label>
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-[#F64651] transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {imagePreview ? (
                <img src={imagePreview} alt="معاينة" className="w-full h-40 object-cover" />
              ) : (
                <div className="h-32 flex flex-col items-center justify-center gap-2 text-gray-400">
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl">🖼</div>
                  <span className="text-xs">انقر لرفع صورة (jpg, png)</span>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png" className="hidden" onChange={handleImageChange} />
            {imageError && (
              <p className="text-xs mt-1 text-right" style={{ color: "#F64651" }}>{imageError}</p>
            )}
            {uploadingImage && <p className="text-xs text-gray-400 mt-1">جاري الرفع...</p>}
            {imagePreview && (
              <button type="button" onClick={() => { setImageUrl(null); setImagePreview(null); }} className="text-xs text-red-500 hover:underline mt-1">
                حذف الصورة
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.name")}</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm"
              placeholder={t("classes.form.name")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.teacher")}</label>
            <select
              value={form.teacherId}
              onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm bg-white"
            >
              <option value="">{t("common.select")}</option>
              {teachers.map((tch) => (
                <option key={tch.id} value={tch.id}>{tch.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("common.academicStage")}</label>
            <select
              value={form.stageId}
              onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm bg-white"
            >
              <option value="">{t("common.select")}</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stageName(stage)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.period")}</label>
            <select
              value={form.period}
              onChange={(e) => setForm((f) => ({ ...f, period: e.target.value as "" | "MORNING" | "EVENING", teacherId: "" }))}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm bg-white"
            >
              <option value="">{t("common.select")}</option>
              <option value="MORNING">{t("periods.MORNING")}</option>
              <option value="EVENING">{t("periods.EVENING")}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.registrationDate")}</label>
            <input
              type="date"
              dir="ltr"
              value={form.registrationDate}
              onChange={(e) => setForm((f) => ({ ...f, registrationDate: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("classes.form.notes")}</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={4}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#F64651] text-sm resize-none"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || uploadingImage}
              className="flex-1 py-2.5 bg-[#F64651] hover:bg-[#D93A44] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60"
            >
              {saving ? t("common.loading") : t("classes.form.save")}
            </button>
            <button
              onClick={() => router.push("/classes")}
              className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-all"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
