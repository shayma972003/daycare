"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { PeriodBadge } from "@/components/ui/StatusBadge";
import { ClassDeleteConfirmModal } from "@/components/classes/ClassDeleteConfirmModal";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { useT, useLocale } from "@/lib/i18n-provider";
import { useAcademicStages, useStageName } from "@/lib/use-academic-stages";
import { formatAst } from "@/lib/datetime";


type Teacher = { id: string; name: string };

type ClassStudent = {
  id: string;
  name: string;
  avatarUrl: string | null;
  period: "MORNING" | "EVENING";
  guardian: { name: string; phone1: string | null } | null;
};

type AvailableStudent = {
  id: string;
  name: string;
  avatarUrl: string | null;
  period: "MORNING" | "EVENING";
};

type ClassData = {
  id: string;
  name: string;
  teacherId: string | null;
  teacher: Teacher | null;
  stage: { id: string; nameAr: string; nameEn: string | null } | null;
  period: "MORNING" | "EVENING" | null;
  registrationDate: string | null;
  notes: string | null;
  students: ClassStudent[];
  _count: { students: number };
};

export default function ClassProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { locale } = useLocale();
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const { stages } = useAcademicStages();
  const stageName = useStageName();
  const { id } = use(params);
  const router = useRouter();

  const [cls, setCls] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [classRefresh, setClassRefresh] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [studentSearch, setStudentSearch] = useState("");


  const [form, setForm] = useState({
    name: "",
    teacherId: "",
    stageId: "",
    period: "" as "" | "MORNING" | "EVENING",
    registrationDate: "",
    notes: "",
  });

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; studentsCount: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [checkingDelete, setCheckingDelete] = useState(false);

  const [showAddStudentsModal, setShowAddStudentsModal] = useState(false);
  const [availableStudents, setAvailableStudents] = useState<AvailableStudent[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [availableError, setAvailableError] = useState<string | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [removingStudentId, setRemovingStudentId] = useState<string | null>(null);

  function fillForm(c: ClassData) {
    setForm({
      name: c.name,
      teacherId: c.teacherId ?? "",
      stageId: c.stage?.id ?? "",
      period: (c.period as "MORNING" | "EVENING") ?? "",
      registrationDate: c.registrationDate ? c.registrationDate.slice(0, 10) : "",
      notes: c.notes ?? "",
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    axios
      .get<ClassData>(`/api/classes/${id}`, { signal: controller.signal })
      .then((res) => {
        setCls(res.data);
        fillForm(res.data);
        setNotFound(false);
      })
      .catch((requestError: unknown) => {
        if (!axios.isCancel(requestError)) setNotFound(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [classRefresh, id]);

  useEffect(() => {
    if (loading) return;
    axios
      .get<Teacher[]>("/api/teachers", { params: form.period ? { period: form.period } : {} })
      .then((res) => setTeachers(res.data))
      .catch(() => setTeachers([]));
  }, [form.period, loading]);

  useEffect(() => {
    if (!showAddStudentsModal) return;
    const controller = new AbortController();
    axios
      .get<AvailableStudent[]>(`/api/classes/${id}/available-students`, { signal: controller.signal })
      .then((res) => {
        setAvailableStudents(res.data);
        setAvailableError(null);
      })
      .catch((requestError: unknown) => {
        if (!axios.isCancel(requestError)) setAvailableError(t("common.error"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingAvailable(false);
      });
    return () => controller.abort();
  }, [showAddStudentsModal, id, t]);

  function refreshClass() {
    setLoading(true);
    setNotFound(false);
    setClassRefresh((value) => value + 1);
  }

  function openAddStudentsModal() {
    setLoadingAvailable(true);
    setAvailableError(null);
    setShowAddStudentsModal(true);
  }

  function toggleSelectStudent(studentId: string) {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((sid) => sid !== studentId) : [...prev, studentId]
    );
  }

  async function handleAddStudents() {
    if (selectedStudentIds.length === 0) return;
    setIsAdding(true);
    try {
      await axios.post(`/api/classes/${id}/add-students`, { studentIds: selectedStudentIds });
      setShowAddStudentsModal(false);
      setSelectedStudentIds([]);
      refreshClass();
    } catch {
      setError(t("common.error"));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemoveStudent(student: ClassStudent) {
    if (removingStudentId) return;
    if (!window.confirm(t("classes.removeStudentConfirm"))) return;
    setRemovingStudentId(student.id);
    setError(null);
    try {
      await axios.delete(`/api/classes/${id}/students?studentId=${encodeURIComponent(student.id)}`);
      refreshClass();
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? (requestError.response?.data?.error ?? t("common.error")) : t("common.error"));
    } finally {
      setRemovingStudentId(null);
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
        stageId: form.stageId || null,
        period: form.period || null,
        registrationDate: form.registrationDate || null,
        notes: form.notes || null,
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
      <div className="min-h-screen bg-brand-bg">
        <Topbar title={t("classes.form.title")} />
        <div className="flex justify-center items-center h-64">
          <div className="w-7 h-7 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (notFound || !cls) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <Topbar title={t("classes.form.title")} />
        <div className="p-6 text-center text-gray-400">{t("common.noData")}</div>
      </div>
    );
  }

  const filteredStudents = cls.students.filter((s) =>
    s.name.toLowerCase().includes(studentSearch.trim().toLowerCase())
  );

  return (
    <div className="min-h-screen bg-brand-bg">
      <Topbar title={cls.name} />
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={() => router.push("/classes")}
            className="text-sm text-[#111111] hover:underline flex items-center gap-1"
          >
            ← {t("classes.title")}
          </button>

          <div className="flex items-center gap-2">
            {!editing ? (
              <PermissionGate permission="classes.manage">
                <button
                  onClick={startEditing}
                  className="px-4 py-2 border border-[#111111] text-[#111111] rounded-lg text-sm font-medium hover:bg-[#111111] hover:text-white transition-colors"
                >
                  {t("classes.edit")}
                </button>
              </PermissionGate>
            ) : (
              <>
                <PermissionGate permission="classes.manage">
                  <button
                    onClick={saveEditing}
                    disabled={saving}
                    className="px-4 py-2 bg-[#F64651] text-white rounded-lg text-sm font-medium hover:bg-[#D93A44] disabled:opacity-60 transition-colors"
                  >
                    {saving ? t("common.loading") : t("classes.form.save")}
                  </button>
                </PermissionGate>
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  {t("common.cancel")}
                </button>
              </>
            )}
            <PermissionGate permission="classes.archive">
              <button
                onClick={openDeleteConfirm}
                disabled={checkingDelete}
                className="px-4 py-2 border border-red-500 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-60 transition-colors"
              >
                {checkingDelete ? t("common.loading") : t("classes.moveToTrash")}
              </button>
            </PermissionGate>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
            {error}
          </div>
        )}

        {/* Info card */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-base font-bold text-[#111111] mb-5">{t("classes.info")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("classes.form.name")}</label>
              {editing ? (
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                />
              ) : (
                <p className="text-sm font-medium text-[#111111]">{cls.name}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("classes.form.teacher")}</label>
              {editing ? (
                <select
                  value={form.teacherId}
                  onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#111111]"
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
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("common.academicStage")}</label>
              {editing ? (
                <select
                  value={form.stageId}
                  onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#111111]"
                >
                  <option value="">{t("common.noStage")}</option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stageName(stage)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-gray-700">{cls.stage ? stageName(cls.stage) : "—"}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("classes.form.period")}</label>
              {editing ? (
                <select
                  value={form.period}
                  onChange={(e) => setForm((f) => ({ ...f, period: e.target.value as "" | "MORNING" | "EVENING", teacherId: "" }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#111111]"
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
                />
              ) : (
                <p className="text-sm text-gray-700">
                  {cls.registrationDate ? formatAst(new Date(cls.registrationDate), { year: "numeric", month: "2-digit", day: "2-digit" }, locale) : "—"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Notes card */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-base font-bold text-[#111111] mb-5">{t("classes.form.notes")}</h2>
          {editing ? (
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={5}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#111111]"
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
            <div className="flex items-center gap-3">
              <PermissionGate permission="classes.assign">
                <button
                  onClick={openAddStudentsModal}
                  title={t("classes.addStudents")}
                  className="w-8 h-8 rounded-full bg-[#F64651] text-white flex items-center justify-center text-lg font-bold hover:bg-[#D93A44] transition-colors"
                >
                  +
                </button>
              </PermissionGate>
              <h2 className="text-base font-bold text-[#111111]">{t("classes.enrolledHere")}</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">{t("classes.studentCount", { n: String(cls.students.length) })}</span>
              <input
                type="text"
                placeholder={t("finance.searchByName")}
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]"
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
                        {t("common.imagePlaceholder")}
                      </div>
                    )}
                  </div>
                  <p className="text-center text-sm font-medium mt-1 truncate flex items-center justify-center gap-1">
                    {student.name}
                    {cls.period && student.period !== cls.period && (
                      <span
                        title={t("classes.periodMismatch", {
                          student: student.period === "MORNING" ? t("periods.MORNING") : t("periods.EVENING"),
                          class: cls.period === "MORNING" ? t("periods.MORNING") : t("periods.EVENING"),
                        })}
                        className="text-yellow text-xs shrink-0"
                      >
                        ⚠
                      </span>
                    )}
                  </p>

                  <PermissionGate permission="classes.assign">
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); void handleRemoveStudent(student); }}
                      disabled={removingStudentId === student.id}
                      className="mt-2 w-full rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {removingStudentId === student.id ? t("common.loading") : t("classes.removeStudent")}
                    </button>
                  </PermissionGate>

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

      <PermissionGate permission="classes.assign">
      {showAddStudentsModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddStudentsModal(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <button
                onClick={() => setShowAddStudentsModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
              <h3 className="font-bold text-[#111111]">{t("classes.addStudents")}</h3>
            </div>

            <p className="text-xs text-gray-400 text-right px-5 pt-3">
              {t("classes.availableFilterHint")}
              {cls.period && ` (${t(`periods.${cls.period}`)})`}
            </p>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingAvailable ? (
                <div className="flex justify-center items-center h-32">
                  <div className="w-6 h-6 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
                </div>
              ) : availableError ? (
                <p role="alert" className="text-center text-red-600 py-8 text-sm">{availableError}</p>
              ) : availableStudents.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">{t("classes.noAvailableStudents")}</p>
              ) : (
                availableStudents.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(s.id)}
                      onChange={() => toggleSelectStudent(s.id)}
                      className="w-4 h-4"
                    />
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
                      {s.avatarUrl ? (
                        <img src={s.avatarUrl} alt={s.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                          {t("common.imagePlaceholder")}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-right">
                      <p className="text-sm font-medium text-[#111111]">{s.name}</p>
                      <p className="text-xs text-gray-400">{t(`periods.${s.period}`)}</p>
                    </div>
                  </label>
                ))
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={handleAddStudents}
                disabled={selectedStudentIds.length === 0 || isAdding}
                className="px-5 py-2.5 rounded-md bg-[#F64651] text-white text-sm font-medium hover:bg-[#D93A44] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isAdding ? t("finance.adding") : `${t("common.add")}${selectedStudentIds.length > 0 ? ` (${selectedStudentIds.length})` : ""}`}
              </button>
              <p className="text-xs text-gray-400">{t("classes.selectedCount", { count: String(selectedStudentIds.length) })}</p>
            </div>
          </div>
        </div>
      )}
      </PermissionGate>

      <PermissionGate permission="classes.archive">
        <ClassDeleteConfirmModal
          isOpen={deleteTarget !== null}
          className={deleteTarget?.name ?? ""}
          assignedStudentsCount={deleteTarget?.studentsCount ?? 0}
          deleting={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </PermissionGate>
    </div>
  );
}
