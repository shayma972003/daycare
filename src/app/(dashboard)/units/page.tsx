"use client";

/**
 * Teaching units (task 2.23).
 *
 * Active and archived are tabs, not a checkbox filter: they are two different
 * activities. Planning this term is done in the first; looking up what was done
 * last year is done in the second, and it should not clutter the first.
 */

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { describeApiError } from "@/lib/api-error";
import { formatAst } from "@/lib/datetime";
import { UnitFilesPanel } from "@/components/units/UnitFilesPanel";

interface UnitRow {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  archivedAt: string | null;
  createdAt: string;
  classIds: string[];
  lessonCount: number;
  fileCount: number;
}

const inputCls =
  "border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2F96A6]";

export default function UnitsPage() {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  /** Only one card's attachments are expanded at a time — the cards are narrow. */
  const [openFilesFor, setOpenFilesFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status, sort });
    if (search.trim()) params.set("search", search.trim());
    try {
      const response = await axios.get<UnitRow[]>(`/api/units?${params.toString()}`);
      setUnits(response.data);
      setError(null);
    } catch (err) {
      setError(describeApiError(err, "تعذر تحميل الوحدات"));
    } finally {
      setLoading(false);
    }
  }, [status, sort, search]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ status, sort });
    if (search.trim()) params.set("search", search.trim());

    // Debounced so typing in the search box does not fire a request per
    // keystroke.
    const timer = setTimeout(() => {
      axios
        .get<UnitRow[]>(`/api/units?${params.toString()}`)
        .then((response) => {
          if (cancelled) return;
          setUnits(response.data);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(describeApiError(err, "تعذر تحميل الوحدات"));
          setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, sort, search]);

  async function createUnit() {
    setSaving(true);
    setError(null);
    try {
      await axios.post("/api/units", { name: newName.trim() });
      setNewName("");
      setCreating(false);
      await load();
    } catch (err) {
      setError(describeApiError(err, "تعذر إنشاء الوحدة"));
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(unit: UnitRow, archived: boolean) {
    setError(null);
    try {
      await axios.put(`/api/units/${unit.id}`, { archived });
      await load();
    } catch (err) {
      setError(describeApiError(err, "تعذر تحديث الوحدة"));
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title="الوحدات التعليمية" />

      <div className="p-6 space-y-4">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex bg-gray-100 rounded-xl p-1">
            {(["active", "archived"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setStatus(option)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  status === option ? "bg-white shadow text-[#111111]" : "text-gray-500"
                }`}
              >
                {option === "active" ? "نشطة" : "مؤرشفة"}
              </button>
            ))}
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث…"
            className={inputCls}
          />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
            className={inputCls}
          >
            <option value="newest">الأحدث أولاً</option>
            <option value="oldest">الأقدم أولاً</option>
          </select>

          <button
            onClick={() => setCreating(true)}
            className="mr-auto px-4 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e]"
          >
            وحدة جديدة
          </button>
        </div>

        {creating && (
          <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="اسم الوحدة"
              className={`${inputCls} flex-1 min-w-[220px]`}
              autoFocus
            />
            <button
              onClick={createUnit}
              disabled={saving || !newName.trim()}
              className="px-5 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e] disabled:opacity-60"
            >
              {saving ? "..." : "إنشاء"}
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
            >
              إلغاء
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-400 py-10 text-center">جارٍ التحميل…</p>
        ) : units.length === 0 ? (
          <p className="text-sm text-gray-400 py-10 text-center">
            {status === "active" ? "لا توجد وحدات نشطة" : "لا توجد وحدات مؤرشفة"}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {units.map((unit) => (
              <div key={unit.id} className="bg-white rounded-2xl shadow-sm p-5 flex flex-col">
                <h3 className="font-bold text-[#111111]">{unit.name}</h3>
                {unit.description && (
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">{unit.description}</p>
                )}

                <div className="text-xs text-gray-500 mt-3 space-y-1">
                  {(unit.startDate || unit.endDate) && (
                    <p>
                      {unit.startDate ? formatAst(new Date(unit.startDate), { month: "short", day: "numeric" }) : "—"}
                      {" ← "}
                      {unit.endDate ? formatAst(new Date(unit.endDate), { month: "short", day: "numeric" }) : "—"}
                    </p>
                  )}
                  <p>
                    {unit.lessonCount} درس · {unit.fileCount} ملف ·{" "}
                    {unit.classIds.length === 0 ? "كل الفصول" : `${unit.classIds.length} فصل`}
                  </p>
                </div>

                <div className="flex gap-3 mt-4 pt-3 border-t border-gray-50">
                  <button
                    onClick={() => setArchived(unit, !unit.archivedAt)}
                    className="text-xs text-[#2F96A6] hover:underline"
                  >
                    {unit.archivedAt ? "إلغاء الأرشفة" : "أرشفة"}
                  </button>
                  <button
                    onClick={() =>
                      setOpenFilesFor((current) => (current === unit.id ? null : unit.id))
                    }
                    className="text-xs text-gray-500 hover:underline"
                  >
                    {openFilesFor === unit.id ? "إخفاء الملفات" : "الملفات"}
                  </button>
                </div>

                {openFilesFor === unit.id && (
                  <UnitFilesPanel
                    unitId={unit.id}
                    onCountChange={(count) =>
                      setUnits((current) =>
                        current.map((row) =>
                          row.id === unit.id ? { ...row, fileCount: count } : row
                        )
                      )
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
