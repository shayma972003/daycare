"use client";

/**
 * A child's care history, grouped by day (task 2.6).
 *
 * Days descending, entries within a day ascending — newest day first because
 * that is what anyone opening the profile wants, but each day read forwards
 * because a day is a story: breakfast, then nap, then mood.
 */

import { useEffect, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { CARE_TYPE_COLORS, CARE_TYPE_LABELS } from "@/lib/care-reports";
import { Icon, CARE_TYPE_ICON_NAMES } from "@/components/ui/Icon";
import { formatAst, astDayStart } from "@/lib/datetime";
import type { CareReportType } from "@/generated/prisma/enums";
import { useT } from "@/lib/i18n-provider";

interface ReportRow {
  id: string;
  type: CareReportType;
  summary: string;
  occurredAt: string;
  reportedByName: string;
  note: string | null;
  photoUrl: string | null;
}

export function StudentCareFeed({ studentId }: { studentId: string }) {
  const t = useT();
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<ReportRow[]>(`/api/care-reports?studentId=${studentId}`)
      .then((response) => {
        if (!cancelled) setReports(response.data);
      })
      .catch((err) => {
        if (!cancelled) setError(describeApiError(err, t("care.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, t]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600 py-4">
        {error}
      </p>
    );
  }

  if (!reports) {
    return <p className="text-sm text-gray-400 py-4">{t("common.loading")}</p>;
  }

  if (reports.length === 0) {
    return <p className="text-sm text-gray-400 py-4">{t("care.noReports")}</p>;
  }

  // Grouped by the AST business day, not the UTC date: a report filed at 01:00
  // Riyadh time belongs to that day, and splitting on the UTC date would file it
  // under the previous one.
  const days = new Map<number, ReportRow[]>();
  for (const report of reports) {
    const key = astDayStart(new Date(report.occurredAt)).getTime();
    const bucket = days.get(key);
    if (bucket) bucket.push(report);
    else days.set(key, [report]);
  }

  const ordered = [...days.entries()].sort(([a], [b]) => b - a);

  return (
    <div className="space-y-5">
      {ordered.map(([day, entries]) => (
        <div key={day}>
          <h4 className="text-xs font-bold text-gray-500 mb-2">
            {formatAst(new Date(day), {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </h4>
          <ul className="space-y-2">
            {entries
              .slice()
              .sort(
                (a, b) =>
                  new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
              )
              .map((report) => (
                <li
                  key={report.id}
                  className="flex items-start gap-3 bg-gray-50 rounded-xl px-3 py-2.5"
                >
                  <Icon
                    name={CARE_TYPE_ICON_NAMES[report.type]}
                    size={18}
                    className={`shrink-0 mt-0.5 ${CARE_TYPE_COLORS[report.type]}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#111111]">
                      <span className="text-gray-500">{CARE_TYPE_LABELS[report.type]}: </span>
                      {report.summary}
                    </p>
                    {report.note && (
                      <p className="text-xs text-gray-600 mt-0.5">{report.note}</p>
                    )}
                    {report.photoUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={report.photoUrl}
                        alt=""
                        // A thumbnail, opened full size in a tab. The staff view
                        // is a scroll of the day's entries, and full-width photos
                        // would bury the text they illustrate.
                        onClick={() => window.open(report.photoUrl!, "_blank")}
                        className="mt-1.5 w-24 h-24 rounded-lg object-cover border border-gray-200 cursor-pointer"
                      />
                    )}
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {formatAst(new Date(report.occurredAt), {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      {report.reportedByName}
                    </p>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
