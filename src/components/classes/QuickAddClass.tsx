"use client";

/**
 * The four fields a room actually needs, in a drawer beside the list.
 *
 * `/classes/new` stays exactly as it is and keeps its own URL. It carries the
 * image upload, the notes and the registration date, and it is what a link in an
 * email should open. This is the other half of the same job: a nursery setting
 * itself up adds six rooms in a row, and six full page loads to type six names
 * is the friction that makes the product feel heavy.
 *
 * Only `name` is required by `POST /api/classes`. Everything else here is
 * optional and editable afterwards, so the fast path stays fast.
 */

import { useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { useT } from "@/lib/i18n-provider";
import { useAcademicStages, useStageName } from "@/lib/use-academic-stages";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  closeDialogOnOpenChange,
} from "@/components/ui/Dialog";

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B14D1]";

export function QuickAddClass({
  open,
  onClose,
  onCreated,
  onNeedFullForm,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onNeedFullForm: () => void;
}) {
  const t = useT();
  const { stages } = useAcademicStages();
  const stageName = useStageName();

  const [name, setName] = useState("");
  const [stageId, setStageId] = useState("");
  const [period, setPeriod] = useState<"" | "MORNING" | "EVENING">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await axios.post("/api/classes", {
        name: name.trim(),
        ...(stageId && { stageId }),
        ...(period && { period }),
      });
      // Cleared so the drawer is ready for the next room — the case this exists
      // for is adding several in a row.
      setName("");
      setStageId("");
      setPeriod("");
      onCreated();
    } catch (err) {
      setError(describeApiError(err, t("classes.createFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => closeDialogOnOpenChange(nextOpen, saving, onClose)}>
      <DialogContent dismissBlocked={saving} className="max-w-md p-5 sm:p-6">
        <DialogDescription className="sr-only">{t("classes.openFullForm")}</DialogDescription>
        <DialogHeader className="mb-5 items-center">
          <DialogTitle>{t("classes.addClass")}</DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              disabled={saving}
              aria-label={t("common.close")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-xl font-bold text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ×
            </button>
          </DialogClose>
        </DialogHeader>

      <form onSubmit={submit} className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">{t("classes.form.name")}</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">{t("common.academicStage")}</label>
          <select
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            className={inputCls}
          >
            <option value="">—</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stageName(stage)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">{t("fields.period")}</label>
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as "" | "MORNING" | "EVENING")}
            className={inputCls}
          >
            <option value="">—</option>
            <option value="MORNING">{t("fields.morning")}</option>
            <option value="EVENING">{t("fields.evening")}</option>
          </select>
        </div>

        <DialogFooter className="pt-4">
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="px-5 py-2.5 bg-[#5B14D1] text-white rounded-xl text-sm font-medium hover:bg-[#490EA9] disabled:opacity-50"
          >
            {saving ? t("careForm.saving") : t("common.save")}
          </button>
          <DialogClose asChild>
            <button
              type="button"
              disabled={saving}
              className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
          </DialogClose>
        </DialogFooter>

        {/* The full form is not hidden — the quick dialog covers the common case, and
            anything it leaves out is one link away. */}
        <button
          type="button"
          onClick={onNeedFullForm}
          disabled={saving}
          className="text-xs text-[#5B14D1] hover:underline pt-1 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("classes.openFullForm")}
        </button>
      </form>
      </DialogContent>
    </Dialog>
  );
}
