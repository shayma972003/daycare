"use client";

import { formatDate } from "@/lib/utils";
import { PeriodBadge } from "@/components/ui/StatusBadge";
import { useT, useLocale } from "@/lib/i18n-provider";
import { useStageName } from "@/lib/use-academic-stages";

export interface Activity {
  id: string;
  name: string;
  teacherName?: string;
  stage?: { id: string; nameAr: string; nameEn: string | null } | null;
  period?: "MORNING" | "EVENING";
  childrenCount?: number;
  startDate?: string | null;
  endDate?: string | null;
  fee?: number;
  imageUrl?: string | null;
  message?: string | null;
  active?: boolean;
}

interface ActivityGridProps {
  activities: Activity[];
  onAdd?: () => void;
  onSelect: (activity: Activity) => void;
}

export function ActivityGrid({ activities, onAdd, onSelect }: ActivityGridProps) {
  const { locale } = useLocale();
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const stageName = useStageName();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {/* Add card */}
      {onAdd && (
        <button
          onClick={onAdd}
          className="bg-white rounded-xl shadow-md border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 min-h-[220px] hover:border-[#F64651] hover:shadow-lg transition-all group cursor-pointer"
        >
          <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-[#F64651]/10 flex items-center justify-center text-2xl text-gray-400 group-hover:text-[#F64651] transition-colors">
            +
          </div>
          <span className="text-sm text-gray-400 group-hover:text-[#F64651] font-medium transition-colors">
            {t("home.addActivity")}
          </span>
        </button>
      )}

      {/* Activity cards */}
      {activities.map((activity) => (
        <button
          key={activity.id}
          onClick={() => onSelect(activity)}
          className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow text-right w-full"
        >
          {/* Activity image */}
          {activity.imageUrl ? (
            <img
              src={activity.imageUrl}
              alt={activity.name}
              className="w-full h-36 object-cover rounded-t-xl"
            />
          ) : (
            <div className="w-full h-36 bg-gray-100 rounded-t-xl flex items-center justify-center text-gray-300">
              <div className="flex flex-col items-center gap-1">
                <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-400">
                  🖼
                </div>
              </div>
            </div>
          )}

          {/* Card body */}
          <div className="p-3 space-y-2">
            <p className="font-bold text-[#111111] text-sm leading-tight line-clamp-1">
              {activity.name}
            </p>

            {activity.teacherName && (
              <p className="text-xs text-gray-500">
                <span className="text-gray-400">{t("home.teacher")}: </span>
                {activity.teacherName}
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              {activity.stage && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                  {stageName(activity.stage)}
                </span>
              )}
              {activity.period && <PeriodBadge period={activity.period} />}
            </div>

            {activity.childrenCount != null && (
              <p className="text-xs text-gray-500">
                {activity.childrenCount} {t("home.children")}
              </p>
            )}

            {(activity.startDate || activity.endDate) && (
              <p className="text-xs text-gray-400">
                {activity.startDate && (
                  <>
                    <span>{t("home.from")} </span>
                    {formatDate(activity.startDate, locale)}
                  </>
                )}
                {activity.endDate && (
                  <>
                    <span> {t("home.to")} </span>
                    {formatDate(activity.endDate, locale)}
                  </>
                )}
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
