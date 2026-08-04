"use client";

/**
 * Managing the school's academic stages (task 2.44).
 *
 * Add, rename, reorder, archive. No delete: a stage children were enrolled in is
 * part of their record, and removing it would either orphan those rows or
 * quietly rewrite what they say. The counts beside each stage are there so the
 * consequence of archiving one is visible before it is archived.
 */

import { useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { useT } from "@/lib/i18n-provider";
import { useAcademicStages, useStageName, type AcademicStage } from "@/lib/use-academic-stages";

export function AcademicStagesPanel() {
  const t = useT();
  const stageName = useStageName();
  const { stages, setStages, loading } = useAcademicStages({ includeArchived: true });

  const [newAr, setNewAr] = useState("");
  const [newEn, setNewEn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ nameAr: "", nameEn: "" });

  function refresh() {
    axios
      .get<AcademicStage[]>("/api/academic-stages?includeArchived=1")
      .then((response) => setStages(response.data))
      .catch(() => {});
  }

  async function add() {
    if (!newAr.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await axios.post("/api/academic-stages", {
        nameAr: newAr.trim(),
        nameEn: newEn.trim() || null,
      });
      setNewAr("");
      setNewEn("");
      refresh();
    } catch (err) {
      setError(describeApiError(err, t("settings.stages.addFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function save(id: string) {
    setBusy(true);
    setError(null);
    try {
      await axios.put(`/api/academic-stages/${id}`, {
        nameAr: draft.nameAr.trim(),
        nameEn: draft.nameEn.trim() || null,
      });
      setEditing(null);
      refresh();
    } catch (err) {
      setError(describeApiError(err, t("settings.stages.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(stage: AcademicStage, archived: boolean) {
    setBusy(true);
    setError(null);
    try {
      await axios.put(`/api/academic-stages/${stage.id}`, { archived });
      refresh();
    } catch (err) {
      setError(describeApiError(err, t("settings.stages.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  /** Swaps with the neighbour, which is what a pair of arrows means. */
  async function move(index: number, direction: -1 | 1) {
    const visible = stages.filter((s) => !s.archivedAt);
    const current = visible[index];
    const neighbour = visible[index + direction];
    if (!current || !neighbour) return;

    setBusy(true);
    try {
      await Promise.all([
        axios.put(`/api/academic-stages/${current.id}`, { sortOrder: neighbour.sortOrder }),
        axios.put(`/api/academic-stages/${neighbour.id}`, { sortOrder: current.sortOrder }),
      ]);
      refresh();
    } catch (err) {
      setError(describeApiError(err, t("settings.stages.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  const active = stages.filter((s) => !s.archivedAt);
  const archived = stages.filter((s) => s.archivedAt);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">{t("settings.stages.hint")}</p>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">{t("common.loading")}</p>
      ) : (
        <ul className="space-y-2">
          {active.map((stage, index) => (
            <li
              key={stage.id}
              className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-xl px-3 py-2"
            >
              {editing === stage.id ? (
                <>
                  <input
                    value={draft.nameAr}
                    onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
                    placeholder={t("settings.stages.nameAr")}
                    className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
                  />
                  <input
                    value={draft.nameEn}
                    onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
                    placeholder={t("settings.stages.nameEn")}
                    dir="ltr"
                    className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => save(stage.id)}
                    disabled={busy || !draft.nameAr.trim()}
                    className="px-3 py-1.5 text-xs bg-[#2F96A6] text-white rounded-lg disabled:opacity-60"
                  >
                    {t("common.save")}
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="px-3 py-1.5 text-xs border border-gray-200 text-gray-600 rounded-lg"
                  >
                    {t("common.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-[140px] text-sm text-[#111111]">
                    {stageName(stage)}
                    {stage.nameEn && (
                      <span className="text-xs text-gray-400" dir="ltr">
                        {" "}
                        · {stage.nameEn}
                      </span>
                    )}
                  </span>

                  {/* Shown so archiving is a decision with the consequence in view. */}
                  <span className="text-xs text-gray-400">
                    {t("settings.stages.usage", {
                      classes: stage.classCount ?? 0,
                      students: stage.studentCount ?? 0,
                    })}
                  </span>

                  <button
                    onClick={() => move(index, -1)}
                    disabled={busy || index === 0}
                    aria-label={t("settings.stages.moveUp")}
                    className="px-2 py-1 text-xs text-gray-500 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={busy || index === active.length - 1}
                    aria-label={t("settings.stages.moveDown")}
                    className="px-2 py-1 text-xs text-gray-500 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => {
                      setEditing(stage.id);
                      setDraft({ nameAr: stage.nameAr, nameEn: stage.nameEn ?? "" });
                    }}
                    className="px-3 py-1.5 text-xs text-[#2F96A6] hover:underline"
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    onClick={() => setArchived(stage, true)}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                  >
                    {t("settings.stages.archive")}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
        <input
          value={newAr}
          onChange={(e) => setNewAr(e.target.value)}
          placeholder={t("settings.stages.nameAr")}
          className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <input
          value={newEn}
          onChange={(e) => setNewEn(e.target.value)}
          placeholder={t("settings.stages.nameEn")}
          dir="ltr"
          className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={add}
          disabled={busy || !newAr.trim()}
          className="px-4 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium disabled:opacity-60"
        >
          {t("settings.stages.add")}
        </button>
      </div>

      {archived.length > 0 && (
        <div className="pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">{t("settings.stages.archivedTitle")}</p>
          <ul className="space-y-1.5">
            {archived.map((stage) => (
              <li key={stage.id} className="flex items-center gap-2 text-sm text-gray-400">
                <span className="flex-1">{stageName(stage)}</span>
                <button
                  onClick={() => setArchived(stage, false)}
                  disabled={busy}
                  className="text-xs text-[#2F96A6] hover:underline disabled:opacity-50"
                >
                  {t("settings.stages.restore")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
