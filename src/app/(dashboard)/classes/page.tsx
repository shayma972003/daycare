"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { PeriodBadge } from "@/components/ui/StatusBadge";
import { useT } from "@/lib/i18n-provider";
import { useAcademicStages, useStageName } from "@/lib/use-academic-stages";
import { useDrawer } from "@/components/ui/Drawer";
import { QuickAddClass } from "@/components/classes/QuickAddClass";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { DataErrorState, RefreshIndicator } from "@/components/ui/DataLoadState";
import { EmptyState } from "@/components/ui/EmptyState";
import { collectionView, type CollectionStatus } from "@/lib/collection-state";
import { LatestRequest } from "@/lib/latest-request";
import { describeApiError } from "@/lib/api-error";


interface ClassItem {
  id: string;
  name: string;
  stage?: { id: string; nameAr: string; nameEn: string | null } | null;
  period?: "MORNING" | "EVENING" | null;
  registrationDate?: string | null;
  notes?: string | null;
  teacherId?: string | null;
  teacher?: { id: string; name: string } | null;
  students: { id: string }[];
  needsTeacherWarning?: boolean;
}

export default function ClassesPage() {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const router = useRouter();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [listStatus, setListStatus] = useState<CollectionStatus>("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [listRefresh, setListRefresh] = useState(0);
  const [classRequests] = useState(() => new LatestRequest());

  const [periodFilter, setPeriodFilter] = useState<"MORNING" | "EVENING" | "all">("all");
  // The school's own stages now, not four hard-coded ones (task 2.44).
  const [stageFilter, setStageFilter] = useState<string>("all");
  const { stages } = useAcademicStages();
  const stageName = useStageName();
  // `?drawer=new-class`, so back closes the panel rather than the page.
  const addClass = useDrawer("new-class");

  useEffect(() => {
    const ticket = classRequests.begin();
    const params: Record<string, string> = {};
    if (periodFilter !== "all") params.period = periodFilter;
    if (stageFilter !== "all") params.stageId = stageFilter;

    axios
      .get<ClassItem[]>("/api/classes", { params, signal: ticket.signal })
      .then((res) => {
        ticket.commit(() => {
          setClasses(res.data);
          setListError(null);
          setListStatus("ready");
        });
      })
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        ticket.commit(() => {
          setListError(describeApiError(requestError, t("common.error")));
          setListStatus("error");
        });
      });

    return ticket.cancel;
  }, [classRequests, listRefresh, periodFilter, stageFilter, t]);

  function refreshClasses() {
    setListStatus(classes.length > 0 ? "refreshing" : "loading");
    setListError(null);
    setListRefresh((value) => value + 1);
  }

  function changePeriod(period: "MORNING" | "EVENING" | "all") {
    setListStatus(classes.length > 0 ? "refreshing" : "loading");
    setListError(null);
    setPeriodFilter(period);
  }

  function changeStage(stageId: string) {
    setListStatus(classes.length > 0 ? "refreshing" : "loading");
    setListError(null);
    setStageFilter(stageId);
  }

  const classesView = collectionView(listStatus, classes.length);

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t("classes.title")} />

      <PermissionGate permission="classes.manage">
        <QuickAddClass
          open={addClass.isOpen}
          onClose={addClass.close}
          onCreated={refreshClasses}
          onNeedFullForm={() => router.push("/classes/new")}
        />
      </PermissionGate>

      <div className="flex-1 space-y-5 p-3 sm:p-4 lg:p-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Period filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{t("classes.filterByPeriod")}:</span>
            <div className="flex max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              {(["all", "MORNING", "EVENING"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => changePeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium transition-all ${
                    periodFilter === p
                      ? "bg-[#5B14D1] text-white"
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
            <div className="flex max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              {[{ id: "all", label: t("common.all") }, ...stages.map((s) => ({ id: s.id, label: stageName(s) }))].map((g) => (
                <button
                  key={g.id}
                  onClick={() => changeStage(g.id)}
                  className={`px-3 py-1.5 text-xs font-medium transition-all ${
                    stageFilter === g.id
                      ? "bg-[#5B14D1] text-white"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {listStatus === "refreshing" && <RefreshIndicator label={t("common.loading")} />}
        {listError && classes.length > 0 && (
          <DataErrorState message={listError} retryLabel={t("common.retry")} onRetry={refreshClasses} />
        )}

        {/* Grid */}
        {classesView === "loading" ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
            {t("common.loading")}
          </div>
        ) : classesView === "error" ? (
          <DataErrorState
            message={listError ?? t("common.error")}
            retryLabel={t("common.retry")}
            onRetry={refreshClasses}
          />
        ) : (
          <>
          {classesView === "empty" && (
            <EmptyState title={t("common.noData")} description={t("classes.noneYet")} />
          )}
          <div data-responsive-class-grid className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {/* Add card */}
            <PermissionGate permission="classes.manage">
              <button
                onClick={addClass.open}
                className="bg-white rounded-xl shadow-md border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 min-h-[220px] hover:border-[#5B14D1] hover:shadow-lg transition-all group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-[#5B14D1]/10 flex items-center justify-center text-2xl text-gray-400 group-hover:text-[#5B14D1] transition-colors">
                  +
                </div>
                <span className="text-sm text-gray-400 group-hover:text-[#5B14D1] font-medium transition-colors">
                  {t("classes.addClass")}
                </span>
              </button>
            </PermissionGate>

            {/* Class cards */}
            {classes.map((cls) => (
              <button
                key={cls.id}
                onClick={() => router.push(`/classes/${cls.id}`)}
                className="relative bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow text-start w-full"
              >
                {cls.needsTeacherWarning && (
                  <span
                    title={t("classes.noHeadTeacher")}
                    className="absolute bottom-2 end-2 z-10 flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-600 text-sm shadow"
                  >
                    ⚠
                  </span>
                )}
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
          </>
        )}
      </div>
    </div>
  );
}
