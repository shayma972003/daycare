"use client";

/**
 * The home screen's opening question, changed from "how is the nursery doing" to
 * "what needs doing".
 *
 * The screen used to lead with counters — children, revenue, expenses. They are
 * true and they are not actionable: knowing revenue is 12,400 does not tell
 * anyone what to open next. Every line here is a number *and* the screen that
 * clears it, so reading the dashboard and acting on it are the same gesture.
 *
 * Lines at zero are dropped rather than shown in grey. A finished list should be
 * short; a list of six "0 remaining" rows is a wall to scan past every morning
 * for no information.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";
import { useT } from "@/lib/i18n-provider";

export interface DashboardTask {
  key: string;
  count: number;
  href: string;
}

/** Lines whose colour should say "this is overdue", not "this is information". */
const URGENT = new Set(["unpaidInvoices", "classesWithoutTeacher"]);

export function TodayTasks({ tasks, loading }: { tasks: DashboardTask[]; loading: boolean }) {
  const t = useT();
  const open = tasks.filter((task) => task.count > 0);

  if (loading) {
    return <p className="text-sm text-gray-400">{t("common.loading")}</p>;
  }

  if (open.length === 0) {
    return (
      <div className="flex items-center gap-3 py-2">
        <span aria-hidden className="w-6 h-6 rounded-full bg-success-bg text-success-text flex items-center justify-center text-xs">
          ✓
        </span>
        <p className="text-sm text-gray-600">{t("todo.allClear")}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {open.map((task) => (
        <li key={task.key}>
          <Link
            href={task.href}
            className="flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-xl hover:bg-gray-50 transition-colors group"
          >
            <span
              aria-hidden
              className={`w-2 h-2 rounded-full shrink-0 ${
                URGENT.has(task.key) ? "bg-coral" : "bg-teal"
              }`}
            />
            <span className="text-sm text-gray-800 flex-1">
              {t(`todo.${task.key}`, { count: String(task.count) })}
            </span>
            <span
              aria-hidden
              className="text-gray-300 group-hover:text-gray-500 transition-colors text-xs"
            >
              ←
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Shared fetch, so the checklist and the task list cost one request between them. */
export function useDashboardTasks() {
  const [data, setData] = useState<{
    tasks: DashboardTask[];
    setup: { steps: { key: string; done: boolean; href: string }[] } | null;
  }>({ tasks: [], setup: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    axios
      .get("/api/dashboard/tasks")
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...data, loading };
}
