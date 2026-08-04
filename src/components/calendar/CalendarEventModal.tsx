"use client";

/**
 * Create and edit a calendar entry.
 *
 * The end time and the room list disappear for an announcement — it has no
 * duration and it concerns everyone. Showing fields that will be ignored teaches
 * people the form lies to them.
 */

import { useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { EVENT_TYPE_LABEL_KEYS } from "@/lib/calendar";
import type { CalendarEventType } from "@/generated/prisma/enums";
import { useT } from "@/lib/i18n-provider";

interface EventRow {
  id: string;
  type: CalendarEventType;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  teacherId: string | null;
  location: string | null;
  classIds: string[];
}

interface Option {
  id: string;
  name: string;
}

/** `datetime-local` wants the local wall clock, not an ISO instant. */
function toInput(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const inputCls =
  "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2F96A6]";

export function CalendarEventModal({
  event,
  defaultDate,
  classes,
  teachers,
  onClose,
  onSaved,
}: {
  event: EventRow | null;
  defaultDate: Date;
  classes: Option[];
  teachers: Option[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const isEdit = Boolean(event);

  const [type, setType] = useState<CalendarEventType>(event?.type ?? "LESSON");
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startAt, setStartAt] = useState(toInput(event?.startAt ?? defaultDate));
  const [endAt, setEndAt] = useState(event?.endAt ? toInput(event.endAt) : "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [teacherId, setTeacherId] = useState(event?.teacherId ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [classIds, setClassIds] = useState<string[]>(event?.classIds ?? []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAnnouncement = type === "ANNOUNCEMENT";

  function toggleClass(id: string) {
    setClassIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        type,
        title: title.trim(),
        description: description.trim() || null,
        startAt: new Date(startAt).toISOString(),
        // Cleared for an announcement and for an all-day entry: both are
        // statements about a day, not a span of hours.
        endAt: isAnnouncement || allDay || !endAt ? null : new Date(endAt).toISOString(),
        allDay,
        teacherId: teacherId || null,
        location: location.trim() || null,
        classIds: isAnnouncement ? [] : classIds,
      };

      if (isEdit && event) {
        await axios.put(`/api/calendar/${event.id}`, payload);
      } else {
        await axios.post("/api/calendar", payload);
      }
      onSaved();
    } catch (err) {
      setError(describeApiError(err, t("calendar.saveFailed")));
      setSaving(false);
    }
  }

  async function remove() {
    if (!event) return;
    setDeleting(true);
    setError(null);
    try {
      await axios.delete(`/api/calendar/${event.id}`);
      onSaved();
    } catch (err) {
      setError(describeApiError(err, t("calendar.deleteFailed")));
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto"
        dir="rtl"
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center">
          <h3 className="font-bold text-[#111111] flex-1">
            {isEdit ? t("calendar.editEvent") : t("calendar.newEvent")}
          </h3>
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

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("finance.type")}</label>
            <div className="flex gap-2">
              {(Object.keys(EVENT_TYPE_LABEL_KEYS) as CalendarEventType[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setType(option)}
                  className={`px-4 py-2 rounded-xl text-sm transition-colors ${
                    type === option
                      ? "bg-[#2F96A6] text-white"
                      : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {t(EVENT_TYPE_LABEL_KEYS[option])}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("settings.address")}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              {isAnnouncement ? t("finance.date") : t("common.from")}
            </label>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className={inputCls}
              dir="ltr"
            />
          </div>

          {!isAnnouncement && (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  className="accent-[#2F96A6]"
                />
                {t("calendar.allDay")}
              </label>

              {!allDay && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("common.to")}</label>
                  <input
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    className={inputCls}
                    dir="ltr"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("fields.teacher")}</label>
                <select
                  value={teacherId}
                  onChange={(e) => setTeacherId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">{t("common.none")}</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  {t("nav.classes")} <span className="text-gray-400">{t("calendar.allClassesHint")}</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {classes.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleClass(item.id)}
                      className={`px-3 py-2 rounded-xl text-sm transition-colors ${
                        classIds.includes(item.id)
                          ? "bg-[#2F96A6] text-white"
                          : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("fields.place")}</label>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className={inputCls}
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("finance.details")}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-4 flex gap-3">
          <button
            onClick={submit}
            disabled={saving || !title.trim() || !startAt}
            className="flex-1 px-5 py-3 bg-[#2F96A6] text-white rounded-xl text-sm font-bold hover:bg-[#26808e] disabled:opacity-60"
          >
            {saving ? t("careForm.saving") : t("common.save")}
          </button>
          {isEdit && (
            <button
              onClick={remove}
              disabled={deleting}
              className="px-5 py-3 border border-red-200 text-red-600 rounded-xl text-sm hover:bg-red-50 disabled:opacity-60"
            >
              {deleting ? "..." : t("common.delete")}
            </button>
          )}
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
