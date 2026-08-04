"use client";

/**
 * The quick-report form (tasks 2.3–2.5).
 *
 * One modal, eight shapes. The fields change with the type but the frame does
 * not, so a teacher who has filed a meal knows where the save button is when she
 * files a nap.
 *
 * Designed for a phone held one-handed while supervising a room: large targets,
 * no free typing where a choice will do, and the time prefilled to now — which
 * is right the overwhelming majority of the time and editable when it is not.
 */

import { useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { Icon, CARE_TYPE_ICON_NAMES } from "@/components/ui/Icon";
import {
  CARE_TYPE_LABELS,
  CARE_TYPE_COLORS,
  MEAL_AMOUNT_LABELS,
  TOILET_KIND_LABELS,
  MOOD_LABELS,
  SUPPLY_URGENCY_LABELS,
} from "@/lib/care-reports";
import type { CareReportType } from "@/generated/prisma/enums";
import { useT } from "@/lib/i18n-provider";

interface Props {
  type: CareReportType;
  /** One child, or several for a batch report. */
  studentIds: string[];
  studentLabel: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** `datetime-local` wants the local wall clock, not an ISO instant. */
function nowForInput(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

const inputCls =
  "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2F96A6]";

export function CareReportModal({
  type,
  studentIds,
  studentLabel,
  onClose,
  onSaved,
}: Props) {
  const t = useT();
  const [occurredAt, setOccurredAt] = useState(nowForInput());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-type fields. Held as one loose object rather than eight useStates —
  // the server blanks everything the type does not own anyway (see
  // buildReportFields), so carrying a stale value here is harmless.
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (key: string, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  /**
   * Uploaded immediately, before the report is saved.
   *
   * The teacher sees the picture and can remove it before filing — which is the
   * point of taking one. An abandoned modal leaves an object nobody references;
   * that is a byte, against a photo that cannot be retaken because the moment
   * has passed.
   */
  async function uploadPhoto(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("studentId", studentIds[0]);
      const response = await axios.post<{ url: string }>("/api/care-reports/photo", form);
      setPhotoUrl(response.data.url);
    } catch (err) {
      setError(describeApiError(err, t("careForm.photoUploadFailed")));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const report = {
        type,
        occurredAt: new Date(occurredAt).toISOString(),
        note: note.trim() || undefined,
        photoUrl: photoUrl || undefined,
        mealName: fields.mealName || undefined,
        mealAmount: fields.mealAmount || undefined,
        napStartAt: fields.napStartAt ? new Date(fields.napStartAt).toISOString() : undefined,
        napEndAt: fields.napEndAt ? new Date(fields.napEndAt).toISOString() : undefined,
        napQuality: fields.napQuality || undefined,
        toiletKind: fields.toiletKind || undefined,
        toiletState: fields.toiletState || undefined,
        mood: fields.mood || undefined,
        medicationName: fields.medicationName || undefined,
        medicationDose: fields.medicationDose || undefined,
        givenByName: fields.givenByName || undefined,
        // Sent as a number: the schema bounds it to 30–45, and a string would
        // fail validation with a message about types rather than about range.
        temperature: fields.temperature ? Number(fields.temperature) : undefined,
        symptom: fields.symptom || undefined,
        actionTaken: fields.actionTaken || undefined,
        supplyItem: fields.supplyItem || undefined,
        supplyQuantity: fields.supplyQuantity ? Number(fields.supplyQuantity) : undefined,
        supplyUrgency: fields.supplyUrgency || undefined,
      };

      const body =
        studentIds.length === 1
          ? { ...report, studentId: studentIds[0] }
          : { studentIds, report };

      const response = await axios.post<{ created: number }>("/api/care-reports", body);
      onSaved(
        studentIds.length === 1
          ? t("careForm.saved")
          : t("careForm.recordedFor", { n: String(response.data.created) })
      );
    } catch (err) {
      setError(describeApiError(err, t("careForm.saveFailed")));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      {/* Bottom sheet on a phone, centred dialog on a desktop — the teacher's
          screen is the phone. */}
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto"
        dir="rtl"
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3">
          <Icon name={CARE_TYPE_ICON_NAMES[type]} size={24} className={CARE_TYPE_COLORS[type]} />
          <div className="flex-1">
            <h3 className="font-bold text-[#111111]">{CARE_TYPE_LABELS[type]}</h3>
            <p className="text-xs text-gray-500">{studentLabel}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none px-2">
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              {error}
            </div>
          )}

          {type !== "NAP" && (
            <Field label={t("careForm.time")}>
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className={inputCls}
                dir="ltr"
              />
            </Field>
          )}

          {type === "MEAL" && (
            <>
              <Field label={t("careForm.meal")}>
                <input
                  value={fields.mealName ?? ""}
                  onChange={(e) => set("mealName", e.target.value)}
                  placeholder={t("careForm.mealHint")}
                  className={inputCls}
                />
              </Field>
              <Field label={t("careForm.amount")}>
                <ChoiceRow
                  options={MEAL_AMOUNT_LABELS}
                  value={fields.mealAmount}
                  onChange={(v) => set("mealAmount", v)}
                />
              </Field>
            </>
          )}

          {type === "NAP" && (
            <>
              <Field label={t("common.from")}>
                <input
                  type="datetime-local"
                  value={fields.napStartAt ?? ""}
                  onChange={(e) => set("napStartAt", e.target.value)}
                  className={inputCls}
                  dir="ltr"
                />
              </Field>
              <Field label={t("common.to")}>
                <input
                  type="datetime-local"
                  value={fields.napEndAt ?? ""}
                  onChange={(e) => set("napEndAt", e.target.value)}
                  className={inputCls}
                  dir="ltr"
                />
              </Field>
              {/* Shown live, but the stored value is computed on the server —
                  the duration and the two timestamps must agree. */}
              <NapDuration start={fields.napStartAt} end={fields.napEndAt} />
              <Field label={t("careForm.napQuality")}>
                <input
                  value={fields.napQuality ?? ""}
                  onChange={(e) => set("napQuality", e.target.value)}
                  placeholder={t("careForm.napHint")}
                  className={inputCls}
                />
              </Field>
            </>
          )}

          {type === "TOILET" && (
            <>
              <Field label={t("careForm.kind")}>
                <ChoiceRow
                  options={TOILET_KIND_LABELS}
                  value={fields.toiletKind}
                  onChange={(v) => set("toiletKind", v)}
                />
              </Field>
              <Field label={t("careForm.state")}>
                <input
                  value={fields.toiletState ?? ""}
                  onChange={(e) => set("toiletState", e.target.value)}
                  className={inputCls}
                />
              </Field>
            </>
          )}

          {type === "MOOD" && (
            <Field label={t("careForm.mood")}>
              <ChoiceRow
                options={MOOD_LABELS}
                value={fields.mood}
                onChange={(v) => set("mood", v)}
              />
            </Field>
          )}

          {type === "MEDICATION" && (
            <>
              <Field label={t("careForm.medicationName")}>
                <input
                  value={fields.medicationName ?? ""}
                  onChange={(e) => set("medicationName", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t("careForm.dose")}>
                <input
                  value={fields.medicationDose ?? ""}
                  onChange={(e) => set("medicationDose", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t("careForm.givenBy")}>
                <input
                  value={fields.givenByName ?? ""}
                  onChange={(e) => set("givenByName", e.target.value)}
                  className={inputCls}
                />
              </Field>
            </>
          )}

          {type === "HEALTH" && (
            <>
              <Field label={t("careForm.temperature")}>
                <input
                  type="number"
                  step="0.1"
                  min="30"
                  max="45"
                  value={fields.temperature ?? ""}
                  onChange={(e) => set("temperature", e.target.value)}
                  className={inputCls}
                  dir="ltr"
                />
              </Field>
              <Field label={t("careForm.symptom")}>
                <input
                  value={fields.symptom ?? ""}
                  onChange={(e) => set("symptom", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t("careForm.actionTaken")}>
                <input
                  value={fields.actionTaken ?? ""}
                  onChange={(e) => set("actionTaken", e.target.value)}
                  className={inputCls}
                />
              </Field>
            </>
          )}

          {type === "SUPPLIES" && (
            <>
              <Field label={t("careForm.supplyItem")}>
                <input
                  value={fields.supplyItem ?? ""}
                  onChange={(e) => set("supplyItem", e.target.value)}
                  placeholder={t("careForm.supplyHint")}
                  className={inputCls}
                />
              </Field>
              <Field label={t("careForm.amount")}>
                <input
                  type="number"
                  min="1"
                  value={fields.supplyQuantity ?? ""}
                  onChange={(e) => set("supplyQuantity", e.target.value)}
                  className={inputCls}
                  dir="ltr"
                />
              </Field>
              <Field label={t("careForm.urgency")}>
                <ChoiceRow
                  options={SUPPLY_URGENCY_LABELS}
                  value={fields.supplyUrgency}
                  onChange={(v) => set("supplyUrgency", v)}
                />
              </Field>
            </>
          )}

          <Field label={type === "GENERAL" ? t("careForm.note") : t("careForm.noteOptional")}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              className={`${inputCls} resize-none`}
            />
          </Field>

          {/* A photo belongs to one child, so it is offered only on a single
              report — attaching the same picture to a batch would send every
              family the same image of somebody else's child. */}
          {studentIds.length === 1 && (
            <Field label={t("careForm.photoOptional")}>
              {photoUrl ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl}
                    alt={t("careForm.attachedPhoto")}
                    className="w-20 h-20 rounded-xl object-cover border border-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotoUrl(null)}
                    className="px-3 py-2 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                  >
                    {t("common.remove")}
                  </button>
                </div>
              ) : (
                <label
                  className={`flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-xl py-4 text-sm text-gray-500 ${
                    uploading ? "opacity-60" : "cursor-pointer hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="file"
                    // `capture` opens the camera straight away on a phone, which
                    // is where this form is used.
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="hidden"
                    disabled={uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadPhoto(file);
                    }}
                  />
                  {uploading ? t("careForm.uploadingPhoto") : t("careForm.addPhoto")}
                </label>
              )}
            </Field>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-4 flex gap-3">
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 px-5 py-3 bg-[#2F96A6] text-white rounded-xl text-sm font-bold hover:bg-[#26808e] disabled:opacity-60"
          >
            {saving ? t("careForm.saving") : t("careForm.submit")}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-3 border border-gray-200 text-gray-600 rounded-xl text-sm"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

/**
 * Choices as buttons rather than a `<select>`.
 *
 * Every option visible at once and one tap away: a dropdown on a phone is two
 * taps and hides the alternatives, which matters when the person choosing is
 * also watching a room.
 */
function ChoiceRow({
  options,
  value,
  onChange,
}: {
  options: Record<string, string>;
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(options).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`px-4 py-2.5 rounded-xl text-sm transition-colors ${
            value === key
              ? "bg-[#2F96A6] text-white"
              : "bg-gray-50 text-gray-700 hover:bg-gray-100"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function NapDuration({ start, end }: { start?: string; end?: string }) {
  if (!start || !end) return null;
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null;
  return (
    <p className="text-xs text-[#2F96A6]">
      المدة: {Math.round((to - from) / 60000)} دقيقة
    </p>
  );
}
