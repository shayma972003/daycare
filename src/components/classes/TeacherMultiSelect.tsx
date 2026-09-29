"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n-provider";

export type ClassTeacherOption = { id: string; name: string };

export function TeacherMultiSelect({
  teachers,
  selectedIds,
  onChange,
  disabled = false,
}: {
  teachers: ClassTeacherOption[];
  selectedIds: string[];
  onChange: (teacherIds: string[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const selected = useMemo(
    () => selectedIds
      .map((id) => teachers.find((teacher) => teacher.id === id))
      .filter((teacher): teacher is ClassTeacherOption => Boolean(teacher)),
    [selectedIds, teachers]
  );
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return teachers;
    return teachers.filter((teacher) => teacher.name.toLocaleLowerCase().includes(query));
  }, [search, teachers]);

  function toggle(teacherId: string) {
    if (disabled) return;
    onChange(
      selectedIds.includes(teacherId)
        ? selectedIds.filter((id) => id !== teacherId)
        : [...selectedIds, teacherId]
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3" data-teacher-multi-select>
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" aria-label={t("classes.selectedTeachers")}>
          {selected.map((teacher) => (
            <span key={teacher.id} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs text-[#5B14D1]">
              {teacher.name}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggle(teacher.id)}
                  className="rounded-full px-1 hover:bg-violet-100"
                  aria-label={t("classes.removeTeacher", { name: teacher.name })}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        disabled={disabled}
        placeholder={t("classes.searchTeachers")}
        aria-label={t("classes.searchTeachers")}
        className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B14D1] disabled:bg-gray-50"
      />

      <div className="max-h-44 space-y-1 overflow-y-auto" role="group" aria-label={t("classes.form.teachers")}>
        {visible.map((teacher) => (
          <label key={teacher.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-gray-50">
            <input
              type="checkbox"
              checked={selectedIds.includes(teacher.id)}
              onChange={() => toggle(teacher.id)}
              disabled={disabled}
              className="h-4 w-4 accent-[#5B14D1]"
            />
            <span>{teacher.name}</span>
          </label>
        ))}
        {visible.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-gray-400">{t("classes.noTeachersFound")}</p>
        )}
      </div>
    </div>
  );
}
