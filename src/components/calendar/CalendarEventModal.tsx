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
import {
  addDateDays,
  deviceTimeZone,
  zonedDateTimeInputToDate,
  zonedDateTimeInputValue,
} from "@/lib/device-date";
import { EVENT_TYPE_LABEL_KEYS } from "@/lib/calendar";
import type { CalendarEventType } from "@/generated/prisma/enums";
import { useT } from "@/lib/i18n-provider";
import { ActivityFormModal } from "@/components/activities/ActivityFormModal";
import type { Activity as ActivityRecord } from "@/components/activities/ActivityGrid";
import { PermissionGate } from "@/components/auth/PermissionGate";
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
  updatedAt?: string;
}

interface Option {
  id: string;
  name: string;
}

/** `datetime-local` carries a wall clock resolved in the user's device zone. */
const inputCls =
  "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B14D1]";

interface CalendarEventModalProps {
  event: EventRow | null;
  /**
   * An existing programme to edit, opened from the calendar.
   *
   * It comes through this component rather than opening the activity form on
   * its own so that editing a programme and editing a lesson are the same
   * dialog — same frame, same heading, same place. Clicking a programme used
   * to raise a second modal with different chrome, which read as a different
   * product.
   */
  activity?: ActivityRecord | null;
  defaultDate: Date;
  classes: Option[];
  teachers: Option[];
  onClose: () => void;
  onSaved: () => void;
}

export function CalendarEventModal(props: CalendarEventModalProps) {
  const sessionKey = props.event
    ? `event:${props.event.id}`
    : props.activity
      ? `activity:${props.activity.id}`
      : `new:${props.defaultDate.toISOString()}`;

  return <CalendarEventModalContent key={sessionKey} {...props} />;
}

function CalendarEventModalContent({
  event,
  activity,
  defaultDate,
  classes,
  teachers,
  onClose,
  onSaved,
}: CalendarEventModalProps) {
  const t = useT();
  const isEdit = Boolean(event) || Boolean(activity);
  const timeZone = deviceTimeZone();

  const [type, setType] = useState<CalendarEventType>(event?.type ?? "LESSON");
  /**
   * The fifth button. Not a `CalendarEventType` — a programme is an `Activity`
   * row with a fee, invited classes and its own notifications, so it has no
   * enum value and never writes an event. It sits beside the four types
   * because that is the one place a reader asks "what am I adding".
   */
  const [programme, setProgramme] = useState(Boolean(activity));
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startAt, setStartAt] = useState(
    event?.allDay
      ? event.startAt.slice(0, 10)
      : zonedDateTimeInputValue(event?.startAt ?? defaultDate, timeZone)
  );
  const [endAt, setEndAt] = useState(
    event?.allDay
      ? addDateDays(event.endAt?.slice(0, 10) ?? event.startAt.slice(0, 10), -1)
      : event?.endAt
        ? zonedDateTimeInputValue(event.endAt, timeZone)
        : zonedDateTimeInputValue(new Date(defaultDate.getTime() + 60 * 60 * 1000), timeZone)
  );
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [teacherId, setTeacherId] = useState(event?.teacherId ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [classIds, setClassIds] = useState<string[]>(event?.classIds ?? []);
  const [notifyGuardians, setNotifyGuardians] = useState(true);
  const [notifyStaff, setNotifyStaff] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [embeddedDismissBlocked, setEmbeddedDismissBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAnnouncement = type === "ANNOUNCEMENT";

  function toggleClass(id: string) {
    setClassIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function submit(sendAnnouncement = false) {
    setSaving(true);
    setError(null);
    try {
      const resolvedStart = isAnnouncement || allDay
        ? new Date(`${startAt}T00:00:00.000Z`)
        : zonedDateTimeInputToDate(startAt, timeZone);
      const resolvedEnd = isAnnouncement
        ? null
        : allDay
          ? new Date(`${addDateDays(endAt || startAt, 1)}T00:00:00.000Z`)
          : zonedDateTimeInputToDate(endAt, timeZone);
      if (!resolvedStart || (!isAnnouncement && (!resolvedEnd || resolvedEnd <= resolvedStart))) {
        setError(t("activities.invalidTiming"));
        setSaving(false);
        return;
      }
      const payload = {
        type,
        title: title.trim(),
        description: description.trim() || null,
        startAt: resolvedStart.toISOString(),
        endAt: resolvedEnd?.toISOString() ?? null,
        allDay: isAnnouncement ? true : allDay,
        timeZone,
        teacherId: teacherId || null,
        location: location.trim() || null,
        classIds,
      };

      const response = isEdit && event
        ? await axios.put<EventRow>(`/api/calendar/${event.id}`, payload)
        : await axios.post<EventRow>("/api/calendar", payload);
      if (sendAnnouncement) {
        if (!response.data.updatedAt) throw new Error(t("calendar.saveFailed"));
        await axios.post(`/api/calendar/${response.data.id}/send`, {
          notifyGuardians,
          notifyStaff,
          message: description.trim(),
          eventVersion: response.data.updatedAt,
          idempotencyKey: crypto.randomUUID(),
          confirmSchoolWide: classIds.length === 0,
        });
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

  function changeAllDay(next: boolean) {
    setAllDay(next);
    if (next) {
      setStartAt(startAt.slice(0, 10));
      setEndAt((endAt || startAt).slice(0, 10));
    } else {
      setStartAt(`${startAt.slice(0, 10)}T09:00`);
      setEndAt(`${(endAt || startAt).slice(0, 10)}T10:00`);
    }
  }

  const dismissBlocked = saving || deleting || embeddedDismissBlocked;

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => closeDialogOnOpenChange(nextOpen, dismissBlocked, onClose)}
    >
      <DialogContent
        dismissBlocked={dismissBlocked}
        overlayClassName="bg-black/40"
        className="inset-x-0 bottom-0 top-auto mx-0 w-full max-w-none translate-y-0 rounded-b-none rounded-t-2xl p-0 sm:inset-x-4 sm:bottom-auto sm:top-1/2 sm:mx-auto sm:max-w-md sm:-translate-y-1/2 sm:rounded-2xl"
      >
        <DialogHeader className="sticky top-0 z-10 items-center border-b border-gray-100 bg-white px-5 py-4">
          <DialogTitle className="flex-1">
            {isEdit ? t("calendar.editEvent") : t("calendar.newEvent")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("calendar.dialogDescription")}
          </DialogDescription>
          <DialogClose asChild>
            <button
              type="button"
              disabled={dismissBlocked}
              aria-label={t("common.close")}
              className="text-gray-400 text-xl leading-none px-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ×
            </button>
          </DialogClose>
        </DialogHeader>

        <div className="p-5 space-y-4">
          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("finance.type")}</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EVENT_TYPE_LABEL_KEYS) as CalendarEventType[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  /* Shown while editing a programme, but not usable: an
                     `Activity` row and a `CalendarEvent` row are different
                     tables. Letting the tab switch would offer a conversion the
                     save cannot perform, and the fields already typed would go
                     to a new event while the programme sat unchanged. */
                  disabled={Boolean(activity)}
                  title={activity ? t("calendar.cannotConvert") : undefined}
                  onClick={() => {
                    setProgramme(false);
                    setType(option);
                    if (option === "ANNOUNCEMENT") {
                      setStartAt(startAt.slice(0, 10));
                      setAllDay(true);
                    }
                  }}
                  className={`min-w-[calc(50%-0.25rem)] flex-1 rounded-xl px-3 py-2 text-sm transition-colors sm:min-w-0 ${
                    !programme && type === option
                      ? "bg-[#5B14D1] text-white"
                      : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                  } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-50`}
                >
                  {t(EVENT_TYPE_LABEL_KEYS[option])}
                </button>
              ))}

              {/* Always the fifth button, so the row is the same everywhere.
                  Disabled while editing an event, for the same reason the four
                  types are disabled while editing a programme: the two live in
                  different tables and neither save can rewrite the other. */}
              <button
                type="button"
                disabled={Boolean(event) || Boolean(activity)}
                title={event ? t("calendar.cannotConvert") : undefined}
                onClick={() => setProgramme(true)}
                className={`min-w-[calc(50%-0.25rem)] flex-1 rounded-xl px-3 py-2 text-sm transition-colors sm:min-w-0 ${
                  programme
                    ? "bg-[#5B14D1] text-white"
                    : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-50`}
              >
                {t("calendar.typeEVENT_ACTIVITY")}
              </button>
            </div>
          </div>

          {/* The programme form, in place. The heading and the type row above
              stay put, so switching back is one click. */}
          {/* Hidden, not unmounted — the event fields below are treated the
              same way. Conditionally rendering it meant switching to a type
              button and back discarded everything typed into the programme. */}
          <div className={programme ? undefined : "hidden"}>
            <ActivityFormModal
              embedded
              open={programme}
              activity={activity ?? null}
              defaultDate={defaultDate}
              onClose={onClose}
              onSaved={onSaved}
              onDismissBlockedChange={setEmbeddedDismissBlocked}
            />
          </div>

          {/* Hidden rather than unmounted while the programme form is showing,
              so switching back keeps whatever was typed. */}
          <div className={programme ? "hidden" : "space-y-4"}>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("calendar.eventTitle")}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </div>
  
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                {isAnnouncement ? t("finance.date") : t("common.from")}
              </label>
              <input
                type={isAnnouncement || allDay ? "date" : "datetime-local"}
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
                    onChange={(e) => changeAllDay(e.target.checked)}
                    className="accent-[#5B14D1]"
                  />
                  {t("calendar.allDay")}
                </label>
  
                {(
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("common.to")}</label>
                    <input
                      type={allDay ? "date" : "datetime-local"}
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
                            ? "bg-[#5B14D1] text-white"
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

            {isAnnouncement && (
              <div className="space-y-4 rounded-xl border border-violet-100 bg-violet-50/50 p-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">{t("fields.teacher")}</label>
                  <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={inputCls}>
                    <option value="">{t("common.none")}</option>
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">
                    {t("nav.classes")} <span className="text-gray-400">{t("calendar.allClassesHint")}</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {classes.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleClass(item.id)}
                        className={`rounded-xl px-3 py-2 text-sm transition-colors ${
                          classIds.includes(item.id)
                            ? "bg-[#5B14D1] text-white"
                            : "bg-white text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs font-medium text-gray-600">{t("calendar.sendAudience")}</p>
                <div className="flex flex-wrap gap-4 text-sm text-gray-700">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={notifyGuardians} onChange={(e) => setNotifyGuardians(e.target.checked)} />
                    {t("calendar.guardians")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={notifyStaff} onChange={(e) => setNotifyStaff(e.target.checked)} />
                    {t("calendar.staff")}
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter
          className={`sticky bottom-0 bg-white px-5 py-4 ${
            programme ? "hidden" : ""
          }`}
        >
          <PermissionGate permission="schedule.manage">
            <button
              type="button"
              onClick={() => void submit(false)}
              disabled={saving || !title.trim() || !startAt}
              className="flex-1 px-5 py-3 bg-[#5B14D1] text-white rounded-xl text-sm font-bold hover:bg-[#490EA9] disabled:opacity-60"
            >
              {saving ? t("careForm.saving") : t("common.save")}
            </button>
          </PermissionGate>
          {isAnnouncement && (
            <PermissionGate permission="schedule.manage">
              <button
                type="button"
                onClick={() => void submit(true)}
                disabled={
                  saving ||
                  !title.trim() ||
                  !startAt ||
                  !description.trim() ||
                  (!notifyGuardians && !notifyStaff)
                }
                className="flex-1 rounded-xl border border-[#5B14D1] px-4 py-3 text-sm font-bold text-[#5B14D1] hover:bg-violet-50 disabled:opacity-50"
              >
                {saving ? t("careForm.saving") : t("calendar.saveAndSend")}
              </button>
            </PermissionGate>
          )}
          {isEdit && (
            <PermissionGate permission="schedule.delete">
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                className="px-5 py-3 border border-red-200 text-red-600 rounded-xl text-sm hover:bg-red-50 disabled:opacity-60"
              >
                {deleting ? "..." : t("common.delete")}
              </button>
            </PermissionGate>
          )}
          <DialogClose asChild>
            <button
              type="button"
              disabled={dismissBlocked}
              className="px-5 py-3 border border-gray-200 text-gray-600 rounded-xl text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
