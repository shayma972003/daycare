"use client";

/**
 * Today's attendance split (task 2.17).
 *
 * A donut rather than a pie: the hole holds the number that actually gets read —
 * how many are in the building — while the ring answers "and the rest?" without
 * a second glance.
 *
 * Built on `recharts`, already a dependency of the statistics screen.
 */

import { useEffect, useState } from "react";
import axios from "axios";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useT } from "@/lib/i18n-provider";
import type { AttendanceStatus } from "@/generated/prisma/enums";

interface WeekResponse {
  rows: {
    cells: { date: string; expected: boolean; status: AttendanceStatus }[];
  }[];
  days: { date: string }[];
}

/** Hex rather than theme tokens because recharts renders to SVG fills. */
const COLORS: Record<AttendanceStatus, string> = {
  PRESENT: "#2D7A4F",
  CHECKED_OUT: "#9CA3AF",
  ABSENT: "#C0232C",
  LEAVE: "#C45000",
  NO_RECORD: "#E5E7EB",
};

const ORDER: AttendanceStatus[] = [
  "PRESENT",
  "CHECKED_OUT",
  "ABSENT",
  "LEAVE",
  "NO_RECORD",
];

export function AttendanceDonut({ classId }: { classId?: string }) {
  const t = useT();
  const [counts, setCounts] = useState<Record<AttendanceStatus, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (classId) params.set("classId", classId);

    axios
      .get<WeekResponse>(`/api/attendance/week?${params.toString()}`)
      .then((response) => {
        if (cancelled) return;
        const today = new Date().toISOString().slice(0, 10);
        const tally = {
          PRESENT: 0,
          CHECKED_OUT: 0,
          ABSENT: 0,
          LEAVE: 0,
          NO_RECORD: 0,
        } as Record<AttendanceStatus, number>;

        for (const row of response.data.rows) {
          const cell = row.cells.find((item) => item.date === today);
          // Children not enrolled today are left out entirely rather than
          // counted as "no record" — they are not missing from the register.
          if (!cell || !cell.expected) continue;
          tally[cell.status]++;
        }
        setCounts(tally);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });

    return () => {
      cancelled = true;
    };
  }, [classId]);

  if (!counts) return null;

  const data = ORDER.filter((status) => counts[status] > 0).map((status) => ({
    name: t(`attendanceStatus.${status}`),
    value: counts[status],
    status,
  }));

  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-8">
        {t("home.noneExpectedToday")}
      </p>
    );
  }

  const present = counts.PRESENT + counts.CHECKED_OUT;

  return (
    <div className="relative" dir="rtl">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={58}
            outerRadius={84}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((entry) => (
              <Cell key={entry.status} fill={COLORS[entry.status]} />
            ))}
          </Pie>
          {/* Recharts types the formatter's value as possibly undefined, so it
              is coerced here rather than asserted away. */}
          <Tooltip
            formatter={(value, name) => [t("home.childrenCount", { count: Number(value ?? 0) }), String(name ?? "")]}
            contentStyle={{ direction: "rtl", fontSize: 12, borderRadius: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* The figure anyone opening this screen is looking for. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-bold text-[#111111]">{present}</span>
        <span className="text-xs text-gray-500">{t("home.ofExpected", { total })}</span>
      </div>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
        {data.map((entry) => (
          <span key={entry.status} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span
              aria-hidden
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: COLORS[entry.status] }}
            />
            {entry.name} ({entry.value})
          </span>
        ))}
      </div>
    </div>
  );
}
