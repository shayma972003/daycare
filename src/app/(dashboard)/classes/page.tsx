"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { PeriodBadge } from "@/components/ui/StatusBadge";
import { useT } from "@/lib/i18n-provider";
import { useAcademicStages, useStageName } from "@/lib/use-academic-stages";


interface ClassItem {
  id: string;
  name: string;
  stage?: { id: string; nameAr: string; nameEn: string | null } | null;
  period?: "MORNING" | "EVENING" | null;
  registrationDate?: string | null;
  notes?: string | null;
  teacherId?: string | null;
  teacher?: { id: string; name: string } | null;
  imageUrl?: string | null;
  students: { id: string }[];
  needsTeacherWarning?: boolean;
}

export default function ClassesPage() {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const router = useRouter();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [periodFilter, setPeriodFilter] = useState<"MORNING" | "EVENING" | "all">("all");
  // The school's own stages now, not four hard-coded ones (task 2.44).
  const [stageFilter, setStageFilter] = useState<string>("all");
  const { stages } = useAcademicStages();
  const stageName = useStageName();

  async function fetchClasses() {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (periodFilter !== "all") params.period = periodFilter;
      if (stageFilter !== "all") params.stageId = stageFilter;

      const res = await axios.get<ClassItem[]>("/api/classes", { params });
      setClasses(res.data);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodFilter, stageFilter]);

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t("classes.title")} />

      <div className="flex-1 p-6 space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Period filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{t("classes.filterByPeriod")}:</span>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
              {(["all", "MORNING", "EVENING"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriodFilter(p)}
                  className={`px-3 py-1.5 text-xs font-medium transition-all ${
                    periodFilter === p
                      ? "bg-[#F64651] text-white"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {p === "all" ? t("common.all") : t(`periods.${p}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Academic stage filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{t("common.filterByStage")}:</span>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
              {[{ id: "all", label: t("common.all") }, ...stages.map((s) => ({ id: s.id, label: stageName(s) }))].map((g) => (
                <button
                  key={g.id}
                  onClick={() => setStageFilter(g.id)}
                  className={`px-3 py-1.5 text-xs font-medium transition-all ${
                    stageFilter === g.id
                      ? "bg-[#F64651] text-white"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
            {t("common.loading")}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Add card */}
            <button
              onClick={() => router.push("/classes/new")}
              className="bg-white rounded-xl shadow-md border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 min-h-[220px] hover:border-[#F64651] hover:shadow-lg transition-all group cursor-pointer"
            >
              <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-[#F64651]/10 flex items-center justify-center text-2xl text-gray-400 group-hover:text-[#F64651] transition-colors">
                +
              </div>
              <span className="text-sm text-gray-400 group-hover:text-[#F64651] font-medium transition-colors">
                {t("classes.addClass")}
              </span>
            </button>

            {/* Class cards */}
            {classes.map((cls) => (
              <button
                key={cls.id}
                onClick={() => router.push(`/classes/${cls.id}`)}
                className="relative bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow text-right w-full"
              >
                {cls.needsTeacherWarning && (
                  <span
                    title="هذا الفصل بدون معلم مسؤول"
                    className="absolute bottom-2 left-2 z-10 flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-600 text-sm shadow"
                  >
                    ⚠
                  </span>
                )}
                {/* Image */}
                <div className="w-full bg-gray-100 flex items-center justify-center text-gray-400" style={{ height: 120 }}>
                  {cls.imageUrl ? (
                    <img src={cls.imageUrl} alt={cls.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center text-xs">
                        [img]
                      </div>
                    </div>
                  )}
                </div>

                {/* Card body */}
                <div className="p-3 space-y-2">
                  <p className="font-bold text-[#111111] text-sm leading-tight line-clamp-1">
                    {cls.name}
                  </p>

                  {cls.teacher && (
                    <p className="text-xs text-gray-500">
                      <span className="text-gray-400">{t("classes.teacher")}: </span>
                      {cls.teacher.name}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {cls.stage && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                        {stageName(cls.stage)}
                      </span>
                    )}
                    {cls.period && <PeriodBadge period={cls.period} />}
                  </div>

                  <p className="text-xs text-gray-500">
                    {cls.students.length} {t("classes.children")}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
