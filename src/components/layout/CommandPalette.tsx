"use client";

/**
 * Ctrl/⌘+K — one way to reach anything.
 *
 * The product has twenty-odd screens behind a menu, and the two questions a user
 * actually asks are "where is that child" and "where do I issue an invoice".
 * Both are answered by typing the thing's name, which is what this is: records
 * and actions in one list, ranked by what was typed.
 *
 * Two rules it must not break:
 *
 * - **Nothing unreachable is listed.** Actions are filtered by the caller's
 *   permissions before they are drawn. An entry that 403s teaches the user the
 *   product is unreliable, and an entry they cannot use still tells them the
 *   feature exists.
 * - **The filtering here is not the control.** `/api/search` re-checks every
 *   permission server-side and scopes every query by `schoolId`. This layer only
 *   decides what is worth drawing.
 *
 * Search is debounced because it runs three queries per keystroke otherwise, and
 * a roster search that fires on every letter is how a nursery's dashboard starts
 * timing out at 8am.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useT } from "@/lib/i18n-provider";
import { usePermissions } from "@/lib/use-permissions";

interface SearchResult {
  kind: string;
  id: string;
  label: string;
  href: string;
}

/** Screens and creates worth jumping to, with the permission each needs. */
const ACTIONS: { key: string; href: string; permission: string | null }[] = [
  { key: "addStudent", href: "/students/new", permission: "students.manage" },
  { key: "addTeacher", href: "/teachers/new", permission: "staff.manage" },
  { key: "addClass", href: "/classes?drawer=new-class", permission: "classes.manage" },
  { key: "care", href: "/care", permission: "students.files" },
  { key: "attendance", href: "/attendance", permission: "attendance.students" },
  { key: "finance", href: "/statistics", permission: "finance.view" },
  { key: "students", href: "/students", permission: "students.view" },
  { key: "classes", href: "/classes", permission: "classes.view" },
  { key: "teachers", href: "/teachers", permission: "staff.view" },
  { key: "rota", href: "/teachers?drawer=rota", permission: "schedule.view" },
  { key: "calendar", href: "/calendar", permission: "schedule.view" },
  { key: "settings", href: "/settings", permission: "settings.manage" },
];

export function CommandPalette() {
  const t = useT();
  const router = useRouter();
  const { can, loading: permissionsLoading } = usePermissions();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cursor, setCursor] = useState(0);

  // Ctrl+K / ⌘+K anywhere, Escape to leave.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        /* Reset on the way in, not in an effect watching `open` — the values
           are already known at the moment the shortcut fires, and setting them
           from an effect costs a second render pass to reach the same place. */
        setOpen((current) => {
          if (current) return false;
          setQuery("");
          setCursor(0);
          return true;
        });
      }
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debounced: three tables per keystroke is not a search box, it is a load test.
  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(() => {
      axios
        .get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((response) => setResults(response.data.results))
        .catch(() => setResults([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const visibleActions = permissionsLoading
    ? []
    : ACTIONS.filter((action) => action.permission === null || can(action.permission)).filter(
        (action) =>
          query.trim().length === 0 ||
          t(`palette.${action.key}`).toLowerCase().includes(query.trim().toLowerCase())
      );

  const rows = [
    ...visibleActions.map((action) => ({
      id: `action:${action.key}`,
      label: t(`palette.${action.key}`),
      hint: t("palette.action"),
      href: action.href,
    })),
    ...(query.trim().length >= 2 ? results : []).map((result) => ({
      id: `${result.kind}:${result.id}`,
      label: result.label,
      hint: t(`palette.kind.${result.kind}`),
      href: result.href,
    })),
  ];

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  function onInputKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => Math.min(current + 1, rows.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(current - 1, 0));
    }
    if (event.key === "Enter" && rows[cursor]) {
      event.preventDefault();
      go(rows[cursor].href);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-modal overflow-hidden"
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={onInputKey}
          placeholder={t("palette.placeholder")}
          className="w-full px-5 py-4 text-sm border-b border-gray-100 focus:outline-none"
        />

        <ul className="max-h-[52vh] overflow-y-auto py-2">
          {rows.length === 0 ? (
            <li className="px-5 py-6 text-sm text-gray-400 text-center">
              {query.trim().length < 2 ? t("palette.hint") : t("palette.noResults")}
            </li>
          ) : (
            rows.map((row, index) => (
              <li key={row.id}>
                <button
                  onClick={() => go(row.href)}
                  onMouseEnter={() => setCursor(index)}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm text-start transition-colors ${
                    index === cursor ? "bg-[#E0F7FA]" : "hover:bg-gray-50"
                  }`}
                >
                  <span className="flex-1 truncate text-gray-800">{row.label}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{row.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="px-5 py-2.5 border-t border-gray-100 text-[11px] text-gray-400 flex gap-4">
          <span>↑↓ {t("palette.navigate")}</span>
          <span>↵ {t("palette.openRow")}</span>
          <span>esc {t("common.close")}</span>
        </div>
      </div>
    </div>
  );
}
