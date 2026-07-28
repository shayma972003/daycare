"use client";

import { useEffect, useState, use, useRef } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { PeriodBadge } from "@/components/ui/StatusBadge";
import { ClassDeleteConfirmModal } from "@/components/classes/ClassDeleteConfirmModal";
import { t } from "@/lib/utils";

type Teacher = { id: string; name: string };

type ClassStudent = {
  id: string;
  name: string;
  avatarUrl: string | null;
  period: "MORNING" | "EVENING";
  guardian: { name: string; phone1: string | null } | null;
};

type ClassData = {
  id: string;
  name: string;
  teacherId: string | null;
  teacher: Teacher | null;
  group: string | null;
  period: "MORNING" | "EVENING" | null;
  registrationDate: string | null;
  notes: string | null;
  imageUrl: string | null;
  students: ClassStudent[];
  _count: { students: number };
};

export default function ClassProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [cls, setCls] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [studentSearch, setStudentSearch] = useState("");

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    teacherId: "",
    group: "",
    period: "" as "" | "MORNING" | "EVENING",
    registrationDate: "",
    notes: "",
  });

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; studentsCount: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [checkingDelete, setCheckingDelete] = useState(false);

  function fillForm(c: ClassData) {
    setForm({
      name: c.name,
      teacherId: c.teacherId ?? "",
      group: c.group ?? "",
      period: (c.period as "MORNING" | "EVENING") ?? "",
      registrationDate: c.registrationDate ? c.registrationDate.slice(0, 10) : "",
      notes: c.notes ?? "",
    });
    setImageUrl(c.imageUrl ?? null);
    setImagePreview(c.imageUrl ?? null);
  }

  async function fetchClass() {
    setLoading(true);
    setNotFound(false);
    try {
      const res = await axios.get<ClassData>(`/api/classes/${id}`);
      setCls(res.data);
      fillForm(res.data);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchClass();
    axios
      .get<Teacher[]>("/api/teachers")
      .then((res) => setTeachers(res.data))
      .catch(() => setTeachers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  function startEditing() {
    if (cls) fillForm(cls);
    setEditing(true);
    setError(null);
  }

  function cancelEditing() {
    if (cls) fillForm(cls);
    setEditing(false);
    setError(null);
  }

  async function saveEditing() {
    setSaving(true);
    setError(null);
    try {
      const res = await axios.put<ClassData>(`/api/classes/${id}`, {
        name: form.name,
        teacherId: form.teacherId || null,
        group: form.group || null,
        period: form.period || null,
        registrationDate: form.registrationDate || null,
        notes: form.notes || null,
        imageUrl: imageUrl ?? null,
      });
      setCls(res.data);
      fillForm(res.data);
      setEditing(false);
    } catch {
      setError(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function openDeleteConfirm() {
    if (!cls || checkingDelete) return;
    setCheckingDelete(true);
    try {
      const res = await axios.get<{ count: number }>(`/api/classes/${cls.id}/students`);
      setDeleteError(null);
      setDeleteTarget({ id: cls.id, name: cls.name, studentsCount: res.data.count ?? 0 });
    } catch {
      setError(t("common.error"));
    } finally {
      setCheckingDelete(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await axios.delete(`/api/classes/${deleteTarget.id}`);
      router.push("/classes");
    } catch {
      setDeleteError(t("common.error"));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-bg">
        <Topbar title={t("classes.form.title")} />
        <div className="flex justify-center items-center h-64">
          <div className="w-7 h-7 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (notFound || !cls) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-bg">
        <Topbar title={t("classes.form.title")} />
        <div className="p-6 text-center text-gray-400">{t("common.noData")}</div>
      </div>
    );
  }

  const filteredStudents = cls.students.filter((s) =>
    s.name.toLowerCase().includes(studentSearch.trim().toLowerCase())
  );

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={cls.name} />
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={() => router.push("/classes")}
            className="text-sm text-[#1a2340] hover:underline flex items-center gap-1"
          >
            ← {t("classes.title")}
          </button>

          <div className="flex items-center gap-2">
            {!editing ? (
              <button
                onClick={startEditing}
                className="px-4 py-2 border border-[#1a2340] text-[#1a2340] rounded-lg text-sm font-medium hover:bg-[#1a2340] hover:text-white transition-colors"
              >
                تعديل الفصل
              </button>
            ) : (
              <>
                <button
                  onClick={saveEditing}
                  disabled={saving || uploadingImage}
                  className="px-4 py-2 bg-[#F64651] text-white rounded-lg text-sm font-medium hover:bg-[#D93A44] disabled:opacity-60 transition-colors"
                >
                  {saving ? t("common.loading") : t("classes.form.save")}
                </button>
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  {t("common.cancel")}
                </button>
              </>
            )}
            <button
              onClick={openDeleteConfirm}
              disabled={checkingDelete}
              className="px-4 py-2 border border-red-500 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-60 transition-colors"
            >
              {checkingDelete ? t("common.loading") : "نقل إلى سلة المحذوفات"}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
            {error}
          </div>
        )}

        {/* Class image */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          {editing ? (
            <div className="p-4">
              <div
                className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-[#F64651] transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <img src={imagePreview} alt={cls.name} className="w-full h-40 object-cover" />
                ) : (
                  <div className="h-32 flex flex-col items-center justify-center gap-2 text-gray-400">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl">🖼</div>
                    <span className="text-xs">انقر لرفع صورة (jpg, png)</span>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png" className="hidden" onChange={handleImageChange} />
              {uploadingImage && <p className="text-xs text-gray-400 mt-1">جاري الرفع...</p>}
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
          ) : cls.imageUrl ? (
            <img src={cls.imageUrl} alt={cls.name} className="w-full h-48 object-cover" />
          ) : (
            <div className="w-full h-40 bg-gray-100 flex items-center justify-center text-gray-400">
              <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-xs">[img]</div>
            </div>
          )}
        </div>

        {/* Info card */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-base font-bold text-[#1a2340] mb-5">معلومات الفصل</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("classes.form.name")}</label>
              {editing ? (
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
                />
              ) : (
                <p className="text-sm font-medium text-[#1a2340]">{cls.name}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("classes.form.teacher")}</label>
              {editing ? (
                <select
                  value={form.teacherId}
                  onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
                >
                  <option value="">{t("common.select")}</option>
                  {teachers.map((tch) => (
                    <option key={tch.id} value={tch.id}>{tch.name}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-gray-700">{cls.teacher?.name ?? "—"}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("classes.form.childrenCount")}</label>
              <p className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500">
                {cls._count.students}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("classes.form.group")}</label>
              {editing ? (
                <select
                  value={form.group}
                  onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
                >
                  <option value="">{t("common.select")}</option>
                  <option value="kg1">{t("groups.kg1")}</option>
                  <option value="kg2">{t("groups.kg2")}</option>
                  <option value="kg3">{t("groups.kg3")}</option>
                  <option value="nursery">{t("groups.nursery")}</option>
                </select>
              ) : (
                <p className="text-sm text-gray-700">{cls.group ? t(`groups.${cls.group}`) : "—"}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("classes.form.period")}</label>
              {editing ? (
                <select
                  value={form.period}
                  onChange={(e) => setForm((f) => ({ ...f, period: e.target.value as "" | "MORNING" | "EVENING" }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
                >
                  <option value="">{t("common.select")}</option>
                  <option value="MORNING">{t("periods.MORNING")}</option>
                  <option value="EVENING">{t("periods.EVENING")}</option>
                </select>
              ) : cls.period ? (
                <PeriodBadge period={cls.period} />
              ) : (
                <p className="text-sm text-gray-700">—</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("classes.form.registrationDate")}</label>
              {editing ? (
                <input
                  type="date"
                  dir="ltr"
                  value={form.registrationDate}
                  onChange={(e) => setForm((f) => ({ ...f, registrationDate: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
                />
              ) : (
                <p className="text-sm text-gray-700">
                  {cls.registrationDate ? new Date(cls.registrationDate).toLocaleDateString("ar-SA") : "—"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Notes card */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-base font-bold text-[#1a2340] mb-5">{t("classes.form.notes")}</h2>
          {editing ? (
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={5}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
            />
          ) : (
            <p className="text-sm text-gray-700 whitespace-pre-line min-h-[2rem]">
              {cls.notes || "—"}
            </p>
          )}
        </div>

        {/* Enrolled children card */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <h2 className="text-base font-bold text-[#1a2340]">الأطفال المسجلين في هذا الفصل</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">{cls.students.length} طالب</span>
              <input
                type="text"
                placeholder="بحث بالاسم..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2340]"
              />
            </div>
          </div>

          {filteredStudents.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t("common.noData")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
              {filteredStudents.map((student) => (
                <div
                  key={student.id}
                  className="relative cursor-pointer group"
                  onClick={() => router.push(`/students/${student.id}`)}
                >
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-100 mx-auto">
                    {student.avatarUrl ? (
                      <img src={student.avatarUrl} alt={student.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                        [صورة]
                      </div>
                    )}
                  </div>
                  <p className="text-center text-sm font-medium mt-1 truncate">{student.name}</p>

                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-white border border-gray-200 rounded-xl shadow-lg p-3 hidden group-hover:block z-10 text-right">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
                        {student.avatarUrl ? (
                          <img src={student.avatarUrl} alt={student.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gray-200 rounded-full" />
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-sm text-gray-900">{student.name}</p>
                        <p className="text-xs text-gray-500">
                          {student.period === "MORNING" ? t("periods.MORNING") : t("periods.EVENING")}
                        </p>
                        <p className="text-xs text-gray-500">{student.guardian?.name ?? "—"}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ClassDeleteConfirmModal
        isOpen={deleteTarget !== null}
        className={deleteTarget?.name ?? ""}
        assignedStudentsCount={deleteTarget?.studentsCount ?? 0}
        deleting={deleting}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
