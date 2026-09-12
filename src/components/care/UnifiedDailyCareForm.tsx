"use client";

import { useMemo, useState, type ReactNode } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { useT } from "@/lib/i18n-provider";

type MealAmount = "ALL" | "HALF" | "LITTLE" | "REFUSED";
type NapStatus = "NO_RECORD" | "SLEPT" | "DID_NOT_SLEEP";
type ToiletValue = "NO_RECORD" | "DIAPER_WET" | "DIAPER_SOILED" | "POTTY";
type Mood = "HAPPY" | "CALM" | "TIRED" | "UPSET" | "CRYING" | "UNWELL";
type ExtraEventKind = "MEAL" | "NAP" | "TOILET";

interface ExtraEvent {
  id: string;
  kind: ExtraEventKind;
  time: string;
  details: string;
}

export interface DailyCareStudent {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface EntryState {
  mealAmount: "" | MealAmount;
  napStatus: NapStatus;
  napStart: string;
  napEnd: string;
  toilet: ToiletValue;
  toiletTime: string;
  mood: "" | Mood;
  note: string;
  extraEvents: ExtraEvent[];
  supplies: string;
  health: string;
  medicationName: string;
  medicationDose: string;
  medicationTime: string;
}

const blankEntry = (): EntryState => ({
  mealAmount: "",
  napStatus: "NO_RECORD",
  napStart: "",
  napEnd: "",
  toilet: "NO_RECORD",
  toiletTime: "",
  mood: "",
  note: "",
  extraEvents: [],
  supplies: "",
  health: "",
  medicationName: "",
  medicationDose: "",
  medicationTime: "",
});

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function batchKey() {
  return globalThis.crypto?.randomUUID?.() ?? `care-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function localIso(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function UnifiedDailyCareForm({
  students,
  date,
  onSaved,
}: {
  students: DailyCareStudent[];
  date: string;
  onSaved: (message: string) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState(() => new Set(students.map((student) => student.id)));
  const [entries, setEntries] = useState<Record<string, EntryState>>(() =>
    Object.fromEntries(students.map((student) => [student.id, blankEntry()]))
  );
  const [mealSource, setMealSource] = useState<"CENTER" | "HOME">("CENTER");
  const [mealName, setMealName] = useState("");
  const [mealTime, setMealTime] = useState(currentTime);
  const [idempotencyKey, setIdempotencyKey] = useState(batchKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<{ kind: ExtraEventKind; time: string; details: string }>({
    kind: "MEAL",
    time: currentTime(),
    details: "",
  });

  const selectedCount = selected.size;
  const allSelected = students.length > 0 && selectedCount === students.length;

  const recordedCount = useMemo(() => {
    return Object.fromEntries(students.map((student) => {
      const entry = entries[student.id] ?? blankEntry();
      const count = [
        entry.mealAmount,
        entry.napStatus !== "NO_RECORD",
        entry.toilet !== "NO_RECORD",
        entry.mood,
        entry.note.trim(),
        entry.extraEvents.length > 0,
        entry.supplies.trim(),
        entry.health.trim(),
        entry.medicationName.trim(),
      ].filter(Boolean).length;
      return [student.id, count];
    }));
  }, [entries, students]);

  const detailsCount = useMemo(() => {
    return Object.fromEntries(students.map((student) => {
      const entry = entries[student.id] ?? blankEntry();
      const count = entry.extraEvents.length + [
        entry.note.trim(),
        entry.supplies.trim(),
        entry.health.trim(),
        entry.medicationName.trim(),
      ].filter(Boolean).length;
      return [student.id, count];
    }));
  }, [entries, students]);

  function updateEntry(studentId: string, patch: Partial<EntryState>) {
    setEntries((current) => ({
      ...current,
      [studentId]: { ...(current[studentId] ?? blankEntry()), ...patch },
    }));
  }

  function toggleStudent(studentId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function openDetails(studentId: string) {
    setEditingStudentId(studentId);
    setDetailError(null);
    setEventDraft({ kind: "MEAL", time: currentTime(), details: "" });
  }

  function validateDetails(entry: EntryState) {
    if (entry.napStatus === "SLEPT" && (!entry.napStart || !entry.napEnd || entry.napEnd <= entry.napStart)) {
      return t("care.validNapTimesRequired");
    }
    const hasMedication = Boolean(entry.medicationName.trim() || entry.medicationDose.trim() || entry.medicationTime);
    if (hasMedication && (!entry.medicationName.trim() || !entry.medicationDose.trim() || !entry.medicationTime)) {
      return t("care.completeMedication");
    }
    return null;
  }

  function closeDetails() {
    if (!editingStudentId) return;
    const validationError = validateDetails(entries[editingStudentId] ?? blankEntry());
    if (validationError) {
      setDetailError(validationError);
      return;
    }
    setEditingStudentId(null);
    setDetailError(null);
  }

  function addExtraEvent() {
    if (!editingStudentId || !eventDraft.time || !eventDraft.details.trim()) {
      setDetailError(t("care.completeExtraEvent"));
      return;
    }
    const event: ExtraEvent = {
      id: globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: eventDraft.kind,
      time: eventDraft.time,
      details: eventDraft.details.trim(),
    };
    const entry = entries[editingStudentId] ?? blankEntry();
    updateEntry(editingStudentId, { extraEvents: [...entry.extraEvents, event] });
    setEventDraft((current) => ({ ...current, details: "" }));
    setDetailError(null);
  }

  async function submit() {
    const chosen = students.filter((student) => selected.has(student.id));
    if (chosen.length === 0) {
      setError(t("care.selectAtLeastOne"));
      return;
    }
    if (mealSource === "CENTER" && !mealName.trim()) {
      setError(t("care.centerMealNameRequired"));
      return;
    }
    if (!mealTime) {
      setError(t("care.mealTimeRequired"));
      return;
    }
    if (chosen.some((student) => !(entries[student.id]?.mealAmount))) {
      setError(t("care.mealAmountForEveryChild"));
      return;
    }
    const invalidDetails = chosen.find((student) => validateDetails(entries[student.id] ?? blankEntry()));
    if (invalidDetails) {
      setEditingStudentId(invalidDetails.id);
      setDetailError(validateDetails(entries[invalidDetails.id] ?? blankEntry()));
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await axios.post<{ created: number }>("/api/care-reports/daily", {
        idempotencyKey,
        meal: {
          source: mealSource,
          name: mealSource === "CENTER" ? mealName.trim() : null,
          occurredAt: localIso(date, mealTime),
        },
        entries: chosen.map((student) => {
          const entry = entries[student.id] ?? blankEntry();
          return {
            studentId: student.id,
            mealAmount: entry.mealAmount || null,
            napStatus: entry.napStatus,
            napStartAt: entry.napStatus === "SLEPT" && entry.napStart
              ? localIso(date, entry.napStart)
              : null,
            napEndAt: entry.napStatus === "SLEPT" && entry.napEnd
              ? localIso(date, entry.napEnd)
              : null,
            toilet: entry.toilet,
            toiletOccurredAt: entry.toilet !== "NO_RECORD" && entry.toiletTime
              ? localIso(date, entry.toiletTime)
              : null,
            mood: entry.mood || null,
            note: entry.note.trim() || null,
            extraEvents: entry.extraEvents.map((event) => ({
              kind: event.kind,
              occurredAt: localIso(date, event.time),
              details: event.details,
            })),
            supplies: entry.supplies.trim() || null,
            health: entry.health.trim() || null,
            medication: entry.medicationName.trim()
              ? {
                  name: entry.medicationName.trim(),
                  dose: entry.medicationDose.trim(),
                  occurredAt: localIso(date, entry.medicationTime),
                }
              : null,
          };
        }),
      });
      setIdempotencyKey(batchKey());
      onSaved(t("care.dailySaved", { n: String(response.data.created) }));
    } catch (saveError) {
      setError(describeApiError(saveError, t("care.dailySaveFailed")));
    } finally {
      setSaving(false);
    }
  }

  const editingStudent = students.find((student) => student.id === editingStudentId);
  if (editingStudent) {
    const entry = entries[editingStudent.id] ?? blankEntry();
    return (
      <ChildDetails
        student={editingStudent}
        entry={entry}
        mealSource={mealSource}
        mealName={mealName}
        mealTime={mealTime}
        eventDraft={eventDraft}
        detailError={detailError}
        onBack={closeDetails}
        onUpdate={(patch) => updateEntry(editingStudent.id, patch)}
        onEventDraft={setEventDraft}
        onAddEvent={addExtraEvent}
        onRemoveEvent={(eventId) => updateEntry(editingStudent.id, {
          extraEvents: entry.extraEvents.filter((event) => event.id !== eventId),
        })}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[#E8E3EF] bg-white p-4 shadow-[0_1px_2px_rgba(36,20,53,0.03)] sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#2D2238]">{t("care.sharedEntry")}</h2>
            <p className="mt-1 text-xs text-[#8B8095]">{t("care.mealOnlyShared")}</p>
          </div>
          <div className="flex rounded-xl bg-[#F7F3FA] p-1" role="group" aria-label={t("care.mealSource")}>
            {(["CENTER", "HOME"] as const).map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setMealSource(source)}
                className={`rounded-lg px-4 py-2 text-xs font-semibold ${
                  mealSource === source ? "bg-[#5B14D1] text-white shadow-sm" : "text-[#756A80] hover:bg-white"
                }`}
              >
                {t(source === "CENTER" ? "care.centerMeal" : "care.homeMeal")}
              </button>
            ))}
          </div>
        </div>

        <div className={`grid gap-3 ${mealSource === "CENTER" ? "md:grid-cols-[1fr_190px]" : "md:grid-cols-1"}`}>
          {mealSource === "CENTER" && (
            <label className="space-y-1.5">
              <span className="text-xs text-[#766B80]">{t("care.mealName")}</span>
              <input
                value={mealName}
                onChange={(event) => setMealName(event.target.value)}
                placeholder={t("care.mealNamePlaceholder")}
                className="h-11 w-full rounded-xl border border-[#E6E0EB] bg-white px-3 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#EDE4FF]"
              />
            </label>
          )}
          <label className="space-y-1.5">
            <span className="text-xs text-[#766B80]">{t("care.mealTime")}</span>
            <input
              type="time"
              value={mealTime}
              onChange={(event) => setMealTime(event.target.value)}
              className="h-11 w-full rounded-xl border border-[#E6E0EB] bg-white px-3 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#EDE4FF]"
            />
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#E8E3EF] bg-white shadow-[0_1px_2px_rgba(36,20,53,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEEAF2] px-4 py-4 sm:px-5">
          <label className="flex items-center gap-2 text-sm font-semibold text-[#44384E]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(students.map((student) => student.id)))}
              className="h-4 w-4 accent-[#5B14D1]"
            />
            {t("care.selectVisibleChildren")}
          </label>
          <p className="text-xs text-[#8B8095]">{t("care.adjustDifferences")}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-[#FCFBFD] text-xs font-medium text-[#918799]">
              <tr>
                <th className="px-4 py-3 text-start">{t("care.child")}</th>
                <th className="px-3 py-3 text-start">{t("care.food")}</th>
                <th className="px-3 py-3 text-start">{t("care.sleep")}</th>
                <th className="px-3 py-3 text-start">{t("care.toilet")}</th>
                <th className="px-3 py-3 text-start">{t("care.mood")}</th>
                <th className="px-3 py-3 text-start">{t("care.additions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0ECF3]">
              {students.map((student) => {
                const entry = entries[student.id] ?? blankEntry();
                const active = selected.has(student.id);
                return (
                  <tr key={student.id} className={active ? "bg-white" : "bg-[#FCFBFD] opacity-60"}>
                    <td className="px-4 py-3 align-top">
                      <label className="flex min-w-[150px] items-center gap-3">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => toggleStudent(student.id)}
                          className="h-4 w-4 accent-[#5B14D1]"
                        />
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1E8FF] text-xs font-bold text-[#5B14D1]">
                          {student.name.slice(0, 1)}
                        </span>
                        <span>
                          <span className="block font-semibold text-[#382D42]">{student.name}</span>
                          <span className="block text-[10px] text-[#958A9E]">
                            {t("care.recordedSections", { n: String(recordedCount[student.id] ?? 0) })}
                          </span>
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <CareSelect
                        ariaLabel={`${t("care.food")} - ${student.name}`}
                        disabled={!active}
                        value={entry.mealAmount}
                        onChange={(value) => updateEntry(student.id, { mealAmount: value as EntryState["mealAmount"] })}
                        options={[
                          ["", t("care.chooseAmount")], ["ALL", t("mealAmount.ALL")],
                          ["HALF", t("mealAmount.HALF")], ["LITTLE", t("mealAmount.LITTLE")],
                          ["REFUSED", t("mealAmount.REFUSED")],
                        ]}
                      />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="space-y-2">
                        <CareSelect
                          ariaLabel={`${t("care.sleep")} - ${student.name}`}
                          disabled={!active}
                          value={entry.napStatus}
                          onChange={(value) => updateEntry(student.id, {
                            napStatus: value as NapStatus,
                            ...(value !== "SLEPT" ? { napStart: "", napEnd: "" } : {}),
                          })}
                          options={[
                            ["NO_RECORD", t("care.notRecorded")],
                            ["SLEPT", t("care.slept")],
                            ["DID_NOT_SLEEP", t("care.didNotSleep")],
                          ]}
                        />
                        {entry.napStatus === "SLEPT" && active && (
                          <div className="grid grid-cols-2 gap-1.5">
                            <input
                              aria-label={t("care.napStart")}
                              type="time"
                              value={entry.napStart}
                              onChange={(event) => updateEntry(student.id, { napStart: event.target.value })}
                              className="h-9 min-w-0 rounded-lg border border-[#E6E0EB] px-2 text-xs outline-none focus:border-[#8B5CF6]"
                            />
                            <input
                              aria-label={t("care.napEnd")}
                              type="time"
                              value={entry.napEnd}
                              onChange={(event) => updateEntry(student.id, { napEnd: event.target.value })}
                              className="h-9 min-w-0 rounded-lg border border-[#E6E0EB] px-2 text-xs outline-none focus:border-[#8B5CF6]"
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <CareSelect
                        ariaLabel={`${t("care.toilet")} - ${student.name}`}
                        disabled={!active}
                        value={entry.toilet}
                        onChange={(value) => updateEntry(student.id, { toilet: value as ToiletValue })}
                        options={[
                          ["NO_RECORD", t("care.notRecorded")],
                          ["DIAPER_WET", t("care.diaperWet")],
                          ["DIAPER_SOILED", t("care.diaperSoiled")],
                          ["POTTY", t("care.usedToilet")],
                        ]}
                      />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <CareSelect
                        ariaLabel={`${t("care.mood")} - ${student.name}`}
                        disabled={!active}
                        value={entry.mood}
                        onChange={(value) => updateEntry(student.id, { mood: value as EntryState["mood"] })}
                        options={[
                          ["", t("care.notRecorded")], ["HAPPY", t("mood.HAPPY")],
                          ["CALM", t("mood.CALM")], ["TIRED", t("mood.TIRED")],
                          ["UPSET", t("mood.UPSET")], ["CRYING", t("mood.CRYING")],
                          ["UNWELL", t("mood.UNWELL")],
                        ]}
                      />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <button
                        type="button"
                        disabled={!active}
                        onClick={() => openDetails(student.id)}
                        className="whitespace-nowrap text-xs font-semibold text-[#5B14D1] hover:underline disabled:opacity-40"
                      >
                        {detailsCount[student.id] > 0
                          ? t("care.detailsCount", { n: String(detailsCount[student.id]) })
                          : t("care.addDetails")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-[#EEEAF2] bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            {!error && <p className="text-xs text-[#8B8095]">{t("care.sendToFamiliesHint")}</p>}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={saving || selectedCount === 0}
            className="min-h-11 rounded-xl bg-[#5B14D1] px-7 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#490EA9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t("care.sendingDaily") : t("care.sendDaily", { n: String(selectedCount) })}
          </button>
        </div>
      </section>
    </div>
  );
}

function ChildDetails({
  student,
  entry,
  mealSource,
  mealName,
  mealTime,
  eventDraft,
  detailError,
  onBack,
  onUpdate,
  onEventDraft,
  onAddEvent,
  onRemoveEvent,
}: {
  student: DailyCareStudent;
  entry: EntryState;
  mealSource: "CENTER" | "HOME";
  mealName: string;
  mealTime: string;
  eventDraft: { kind: ExtraEventKind; time: string; details: string };
  detailError: string | null;
  onBack: () => void;
  onUpdate: (patch: Partial<EntryState>) => void;
  onEventDraft: (value: { kind: ExtraEventKind; time: string; details: string }) => void;
  onAddEvent: () => void;
  onRemoveEvent: (eventId: string) => void;
}) {
  const t = useT();
  const inputClass = "h-11 w-full rounded-xl border border-[#E6E0EB] bg-white px-3 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#EDE4FF]";

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-[#5B14D1] hover:bg-[#F1E8FF]"
      >
        <span aria-hidden="true">→</span>
        {t("care.backToClass")}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#2D2238] sm:text-2xl">{t("care.childReport", { name: student.name })}</h2>
          <p className="mt-1 text-xs text-[#8B8095]">{t("care.detailsDraftHint")}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1E8FF] font-bold text-[#5B14D1]">
          {student.name.slice(0, 1)}
        </span>
      </div>

      <section className="rounded-2xl border border-[#E8E3EF] bg-white p-4 shadow-[0_1px_2px_rgba(36,20,53,0.03)] sm:p-5">
        <h3 className="mb-4 text-base font-bold text-[#2D2238]">{t("care.todayDetails")}</h3>
        <div className="mb-4 rounded-xl bg-[#FAF8FC] px-4 py-3 text-xs text-[#756A80]">
          {mealSource === "CENTER"
            ? t("care.sharedCenterMealSummary", { name: mealName || "—", time: mealTime || "—" })
            : t("care.sharedHomeMealSummary", { time: mealTime || "—" })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DetailSelect
            label={t("care.foodAmount")}
            value={entry.mealAmount}
            onChange={(value) => onUpdate({ mealAmount: value as EntryState["mealAmount"] })}
            options={[
              ["", t("care.chooseAmount")], ["ALL", t("mealAmount.ALL")],
              ["HALF", t("mealAmount.HALF")], ["LITTLE", t("mealAmount.LITTLE")],
              ["REFUSED", t("mealAmount.REFUSED")],
            ]}
          />
          <DetailSelect
            label={t("care.sleep")}
            value={entry.napStatus}
            onChange={(value) => onUpdate({
              napStatus: value as NapStatus,
              ...(value !== "SLEPT" ? { napStart: "", napEnd: "" } : {}),
            })}
            options={[
              ["NO_RECORD", t("care.notRecorded")], ["SLEPT", t("care.slept")],
              ["DID_NOT_SLEEP", t("care.didNotSleep")],
            ]}
          />
          {entry.napStatus === "SLEPT" && (
            <>
              <DetailInput label={t("care.napStart")} type="time" value={entry.napStart} onChange={(value) => onUpdate({ napStart: value })} />
              <DetailInput label={t("care.napEnd")} type="time" value={entry.napEnd} onChange={(value) => onUpdate({ napEnd: value })} />
            </>
          )}
          <DetailSelect
            label={t("care.toilet")}
            value={entry.toilet}
            onChange={(value) => onUpdate({ toilet: value as ToiletValue })}
            options={[
              ["NO_RECORD", t("care.notRecorded")], ["DIAPER_WET", t("care.diaperWet")],
              ["DIAPER_SOILED", t("care.diaperSoiled")], ["POTTY", t("care.usedToilet")],
            ]}
          />
          {entry.toilet !== "NO_RECORD" && (
            <DetailInput label={t("care.eventTime")} type="time" value={entry.toiletTime} onChange={(value) => onUpdate({ toiletTime: value })} />
          )}
          <DetailSelect
            label={t("care.mood")}
            value={entry.mood}
            onChange={(value) => onUpdate({ mood: value as EntryState["mood"] })}
            options={[
              ["", t("care.notRecorded")], ["HAPPY", t("mood.HAPPY")],
              ["CALM", t("mood.CALM")], ["TIRED", t("mood.TIRED")],
              ["UPSET", t("mood.UPSET")], ["CRYING", t("mood.CRYING")],
              ["UNWELL", t("mood.UNWELL")],
            ]}
          />
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs text-[#766B80]">{t("care.familyNote")}</span>
            <textarea
              value={entry.note}
              onChange={(event) => onUpdate({ note: event.target.value })}
              maxLength={600}
              rows={3}
              placeholder={t("care.familyNotePlaceholder")}
              className="w-full resize-y rounded-xl border border-[#E6E0EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#EDE4FF]"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-[#E8E3EF] bg-white p-4 shadow-[0_1px_2px_rgba(36,20,53,0.03)] sm:p-5">
        <h3 className="mb-3 text-base font-bold text-[#2D2238]">{t("care.onlyWhenNeeded")}</h3>

        <details className="group border-t border-[#EEEAF2] py-3 first:border-t-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[#3D3346]">
            <span>
              {t("care.addAnotherEvent")}
              <span className="ms-2 text-xs font-normal text-[#8B8095]">{t("care.extraEventHint")}</span>
            </span>
            <span aria-hidden="true" data-disclosure-arrow className="ms-auto inline-flex text-xs text-[#8B8095] transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DetailSelect
              label={t("care.eventType")}
              value={eventDraft.kind}
              onChange={(value) => onEventDraft({ ...eventDraft, kind: value as ExtraEventKind })}
              options={[
                ["MEAL", t("care.extraMeal")],
                ["NAP", t("care.extraNap")],
                ["TOILET", t("care.toilet")],
              ]}
            />
            <DetailInput label={t("care.eventTime")} type="time" value={eventDraft.time} onChange={(value) => onEventDraft({ ...eventDraft, time: value })} />
            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-xs text-[#766B80]">{t("care.eventDetails")}</span>
              <input
                value={eventDraft.details}
                onChange={(event) => onEventDraft({ ...eventDraft, details: event.target.value })}
                maxLength={200}
                placeholder={t("care.eventDetailsPlaceholder")}
                className={inputClass}
              />
            </label>
            <button type="button" onClick={onAddEvent} className="min-h-10 rounded-xl border border-[#DED6E6] px-4 text-sm font-semibold text-[#5B14D1] hover:bg-[#F1E8FF]">
              {t("care.addEvent")}
            </button>
          </div>
          {entry.extraEvents.length > 0 && (
            <div className="mt-3 divide-y divide-[#EEEAF2] rounded-xl bg-[#FAF8FC] px-3">
              {entry.extraEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-3 py-2 text-xs text-[#554A5E]">
                  <span>{t(`care.extraEvent${event.kind}`)} · <bdi>{event.time}</bdi> · {event.details}</span>
                  <button type="button" onClick={() => onRemoveEvent(event.id)} className="text-[#5B14D1] hover:underline">
                    {t("common.remove")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </details>

        <OptionalDetails title={t("care.suppliesRequest")} open={Boolean(entry.supplies)}>
          <DetailInput label={t("care.requestedSupplies")} value={entry.supplies} onChange={(value) => onUpdate({ supplies: value })} maxLength={150} />
        </OptionalDetails>

        <OptionalDetails title={t("care.healthNote")} hint={t("care.healthPrivateHint")} open={Boolean(entry.health)}>
          <label className="space-y-1.5">
            <span className="text-xs text-[#766B80]">{t("care.healthAction")}</span>
            <textarea
              value={entry.health}
              onChange={(event) => onUpdate({ health: event.target.value })}
              maxLength={600}
              rows={3}
              className="w-full resize-y rounded-xl border border-[#E6E0EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#EDE4FF]"
            />
          </label>
        </OptionalDetails>

        <OptionalDetails title={t("care.medicationRecord")} hint={t("care.medicationConsentHint")} open={Boolean(entry.medicationName)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <DetailInput label={t("care.medicationName")} value={entry.medicationName} onChange={(value) => onUpdate({ medicationName: value })} maxLength={150} />
            <DetailInput label={t("care.medicationDose")} value={entry.medicationDose} onChange={(value) => onUpdate({ medicationDose: value })} maxLength={150} />
            <DetailInput label={t("care.medicationTime")} type="time" value={entry.medicationTime} onChange={(value) => onUpdate({ medicationTime: value })} />
          </div>
        </OptionalDetails>
      </section>

      {detailError && <p role="alert" className="text-sm text-red-600">{detailError}</p>}
      <footer className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[#8B8095]">{t("care.draftUntilSend")}</span>
        <button type="button" onClick={onBack} className="min-h-11 rounded-xl bg-[#5B14D1] px-6 text-sm font-bold text-white hover:bg-[#490EA9]">
          {t("care.saveAndReturn")}
        </button>
      </footer>
    </div>
  );
}

function DetailInput({
  label,
  value,
  onChange,
  type = "text",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "time";
  maxLength?: number;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs text-[#766B80]">{label}</span>
      <input
        aria-label={label}
        type={type}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[#E6E0EB] bg-white px-3 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#EDE4FF]"
      />
    </label>
  );
}

function DetailSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs text-[#766B80]">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[#E6E0EB] bg-white px-3 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#EDE4FF]"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function OptionalDetails({
  title,
  hint,
  open,
  children,
}: {
  title: string;
  hint?: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-[#EEEAF2] py-3" open={open || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[#3D3346]">
        <span>
          {title}
          {hint && <span className="ms-2 text-xs font-normal text-[#8B8095]">{hint}</span>}
        </span>
        <span aria-hidden="true" data-disclosure-arrow className="ms-auto inline-flex text-xs text-[#8B8095] transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function CareSelect({
  ariaLabel,
  value,
  options,
  onChange,
  disabled,
}: {
  ariaLabel: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="h-10 w-full min-w-[120px] rounded-lg border border-[#E6E0EB] bg-white px-2 text-xs text-[#554A5E] outline-none focus:border-[#8B5CF6] disabled:bg-[#F7F5F8]"
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>{label}</option>
      ))}
    </select>
  );
}
