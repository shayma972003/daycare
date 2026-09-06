"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  closeDialogOnOpenChange,
} from "@/components/ui/Dialog";

import { describeApiError } from "@/lib/api-error";
import type { Activity } from "./ActivityGrid";
import { useT } from "@/lib/i18n-provider";
import { useAcademicStages, useStageName } from "@/lib/use-academic-stages";
import { PermissionGate } from "@/components/auth/PermissionGate";
import {
  dateKeyInTimeZone,
  deviceTimeZone,
  zonedDateTimeInputValue,
} from "@/lib/device-date";
import { buildActivityRequestPayload } from "@/lib/activity-timing";

/**
 * An emptied number box is zero, not `NaN`.
 *
 * `valueAsNumber` yields `NaN` when the field is cleared, `JSON.stringify`
 * writes that as `null`, and the zod schema rejects null on a field it calls
 * optional — so clearing the fee returned a 400 that, in the embedded form,
 * was invisible.
 */
function emptyToZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface Teacher {
  id: string;
  name: string;
}

interface ClassItem {
  id: string;
  name: string;
}

/** Shape of `GET /api/activities/[id]` — the fields the grid does not carry. */
interface ActivityDetails {
  teacherId: string | null;
  stageId?: string | null;
  activityInvites?: { classId: string }[];
  allDay?: boolean | null;
  message?: string | null;
  updatedAt: string;
}

interface SavedSendSnapshot {
  message: string;
  teacherId: string;
  classIds: string[];
  activityVersion: string;
}

type ActivityDetailsStatus = "idle" | "loading" | "ready" | "error";

interface ActivityFormValues {
  name: string;
  teacherId: string;
  childrenCount: number;
  stageId: string;
  period: "MORNING" | "EVENING";
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  fee: number;
  message: string;
  classIds: string[];
}

interface ActivityFormModalProps {
  open: boolean;
  onClose: () => void;
  activity: Activity | null;
  onSaved: () => void;
  /** Lets an embedding dialog block dismissal while this form is mutating. */
  onDismissBlockedChange?: (blocked: boolean) => void;
  /**
   * Renders the fields alone, with no dialog around them.
   *
   * The calendar shows this form *inside* its own "new event" dialog, beside
   * the type buttons, so switching between a lesson and a programme is one
   * click and the heading never moves. A second Dialog would stack one modal
   * on another — two overlays, two close buttons, and a type row the reader
   * can no longer see or reach.
   */
  embedded?: boolean;
  defaultDate?: Date;
}

export function ActivityFormModal({
  open,
  onClose,
  activity,
  onSaved,
  embedded,
  defaultDate,
  onDismissBlockedChange,
}: ActivityFormModalProps) {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const { stages } = useAcademicStages();
  const stageName = useStageName();
  const isEdit = !!activity;

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(false);
  /* "The request failed" and "you have no classes" are different facts and were
     both being drawn as "no data". One is a bug to report, the other is a step
     the user has not taken yet — and the empty list gave no way to tell. */
  const [classesFailed, setClassesFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentNotice, setSentNotice] = useState(false);
  const [detailsStatus, setDetailsStatus] = useState<ActivityDetailsStatus>("idle");
  const detailsRequestId = useRef(0);
  const detailsRequestController = useRef<AbortController | null>(null);
  const activeActivityId = useRef<string | null>(null);
  // Opt-in, not automatic. Saving and sending an in-app message are separate
  // actions, so fixing a title never sends the activity message again.
  const [notifyGuardians, setNotifyGuardians] = useState(false);
  /* Staff were never told. The message went to guardians only, so the teacher
     expected to run the activity found out when the children turned up. */
  const [notifyStaff, setNotifyStaff] = useState(false);
  const sendKey = useRef<string | null>(null);
  const [confirmSchoolWide, setConfirmSchoolWide] = useState(false);
  const [savedSendSnapshot, setSavedSendSnapshot] = useState<SavedSendSnapshot | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<ActivityFormValues>({
    defaultValues: {
      name: "",
      teacherId: "",
      childrenCount: 0,
      stageId: "",
      period: "MORNING",
      startDate: "",
      endDate: "",
      startTime: "09:00",
      endTime: "10:00",
      allDay: true,
      fee: 0,
      message: "",
      classIds: [],
    },
  });

  const selectedClassIds = watch("classIds") ?? [];
  const allDay = watch("allDay");
  const loadingDetails = detailsStatus === "loading";

  const loadActivityDetails = useCallback((activityId: string) => {
    detailsRequestController.current?.abort();
    const controller = new AbortController();
    const requestId = ++detailsRequestId.current;
    detailsRequestController.current = controller;
    activeActivityId.current = activityId;
    setDetailsStatus("loading");
    setError(null);

    void axios
      .get<ActivityDetails>(`/api/activities/${activityId}`, { signal: controller.signal })
      .then((r) => {
        if (
          controller.signal.aborted ||
          requestId !== detailsRequestId.current ||
          controller !== detailsRequestController.current ||
          activityId !== activeActivityId.current
        ) return;
        const classIds = (r.data.activityInvites ?? []).map((invite) => invite.classId);
        setValue("teacherId", r.data.teacherId ?? "");
        setValue("classIds", classIds);
        setValue("message", r.data.message ?? "");
        setSavedSendSnapshot({
          message: r.data.message ?? "",
          teacherId: r.data.teacherId ?? "",
          classIds: [...classIds].sort(),
          activityVersion: r.data.updatedAt,
        });
        setDetailsStatus("ready");
      })
      .catch(() => {
        if (
          controller.signal.aborted ||
          requestId !== detailsRequestId.current ||
          controller !== detailsRequestController.current ||
          activityId !== activeActivityId.current
        ) return;
        setError(t("activities.loadFailed"));
        setDetailsStatus("error");
      });
  }, [setValue, t]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    setLoadingTeachers(true);
    axios
      .get<Teacher[]>("/api/teachers", { signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setTeachers(r.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTeachers([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTeachers(false);
      });

    setLoadingClasses(true);
    setClassesFailed(false);
    axios
      .get<ClassItem[]>("/api/classes", { signal: controller.signal })
      .then((r) => {
        if (controller.signal.aborted) return;
        setClasses(r.data);
        setClassesFailed(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setClasses([]);
        setClassesFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingClasses(false);
      });
    return () => controller.abort();
  }, [open]);

  /**
   * Loads the full record when editing.
   *
   * The grid only carries `teacherName` — no `teacherId`, no class list — so the
   * form used to open with the teacher select empty and no classes ticked, and
   * saving wrote those blanks back. Opening an activity and pressing save
   * silently unassigned its teacher and cancelled every class invitation.
   */
  useEffect(() => {
    setError(null);
    /* Reset per opening. The dashboard keeps this modal mounted, so a ticked
       box survived into the next activity — saving B re-messaged every
       guardian because A had been sent. */
    setNotifyGuardians(false);
    setNotifyStaff(false);
    setConfirmSchoolWide(false);
    sendKey.current = null;
    setSentNotice(false);
    setSavedSendSnapshot(null);
    setDetailsStatus("idle");

    if (open && activity) {
      const timeZone = deviceTimeZone();
      const dateOnly = activity.allDay !== false;
      reset({
        name: activity.name ?? "",
        teacherId: "",
        childrenCount: activity.childrenCount ?? 0,
        // The list carries the stage nested; the form needs only its id.
        stageId: activity.stage?.id ?? "",
        period: activity.period ?? "MORNING",
        startDate: activity.startDate
          ? dateOnly ? activity.startDate.slice(0, 10) : dateKeyInTimeZone(new Date(activity.startDate), timeZone)
          : "",
        endDate: activity.endDate
          ? dateOnly ? activity.endDate.slice(0, 10) : dateKeyInTimeZone(new Date(activity.endDate), timeZone)
          : "",
        startTime: activity.startDate && !dateOnly
          ? zonedDateTimeInputValue(activity.startDate, timeZone).slice(11)
          : "09:00",
        endTime: activity.endDate && !dateOnly
          ? zonedDateTimeInputValue(activity.endDate, timeZone).slice(11)
          : "10:00",
        allDay: dateOnly,
        fee: activity.fee ?? 0,
        message: activity.message ?? "",
        classIds: [],
      });
      setImageUrl(activity.imageUrl ?? null);
      setImagePreview(activity.imageUrl ?? null);

      loadActivityDetails(activity.id);
      return () => {
        detailsRequestController.current?.abort();
        detailsRequestController.current = null;
        activeActivityId.current = null;
        detailsRequestId.current += 1;
      };
    } else if (open && !activity) {
      const timeZone = deviceTimeZone();
      const seed = defaultDate ?? new Date();
      const seedInput = zonedDateTimeInputValue(seed, timeZone);
      const endInput = zonedDateTimeInputValue(new Date(seed.getTime() + 60 * 60 * 1000), timeZone);
      reset({
        name: "",
        teacherId: "",
        childrenCount: 0,
        stageId: "",
        period: "MORNING",
        startDate: defaultDate ? seedInput.slice(0, 10) : "",
        endDate: defaultDate ? endInput.slice(0, 10) : "",
        startTime: seedInput.slice(11),
        endTime: endInput.slice(11),
        allDay: !defaultDate,
        fee: 0,
        message: "",
        classIds: [],
      });
      setImageUrl(null);
      setImagePreview(null);
    }
  }, [open, activity, defaultDate, loadActivityDetails, reset]);

  const toggleClass = (id: string) => {
    const current = selectedClassIds.includes(id)
      ? selectedClassIds.filter((c) => c !== id)
      : [...selectedClassIds, id];
    setValue("classIds", current);
  };

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload to server
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post<{ url: string }>("/api/upload", fd);
      setImageUrl(res.data.url);
    } catch {
      setError(t("common.uploadFailed"));
    } finally {
      setUploadingImage(false);
    }
  }

  const onSubmit = async (data: ActivityFormValues) => {
    if (isEdit && detailsStatus !== "ready") {
      setError(t("activities.loadFailed"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const timeZone = deviceTimeZone();
      const payload = buildActivityRequestPayload(data, imageUrl, timeZone);
      if (!payload) {
        setError(t("activities.invalidTiming"));
        setSaving(false);
        return;
      }

      /**
       * The id to notify about, whichever branch we took.
       *
       * Creating used to POST and stop there while the button read "save and
       * send" — so a new activity announced itself to nobody, and the only way
       * to find out was that no guardian mentioned it. The create branch now
       * honours the same two checkboxes the edit branch does.
       */
      if (isEdit && activity) {
        await axios.put(`/api/activities/${activity.id}`, payload);
      } else {
        await axios.post("/api/activities", payload);
      }

      // Only when asked. Every edit used to fire this, so fixing a typo in the
      // title re-messaged every guardian in every invited class.
      onSaved();
      onClose();
    } catch (err) {
      setError(describeApiError(err, t("common.error")));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Sends without saving.
   *
   * Ticking a box and pressing save is the right shape when the decision is made
   * while writing the activity. It is the wrong shape a week later: the message
   * was not sent at the time, and the only way to send it was to re-save a
   * record that needed no change — which also risks sending an edit nobody
   * asked for. This posts to the same endpoint and touches nothing else.
   */
  const handleSendNow = async () => {
    if (!activity) return;
    if (!savedSendSnapshot || loadingDetails) {
      setError(t("activities.loadFailed"));
      return;
    }
    if (!notifyGuardians && !notifyStaff) {
      setError(t("activities.pickAudience"));
      return;
    }
    const message = getValues("message") ?? "";
    if (!message.trim()) {
      setError(t("activities.messageRequired"));
      return;
    }
    const currentClassIds = [...(getValues("classIds") ?? [])].sort();
    if (
      message !== savedSendSnapshot.message ||
      (getValues("teacherId") ?? "") !== savedSendSnapshot.teacherId ||
      currentClassIds.join("\u0000") !== savedSendSnapshot.classIds.join("\u0000")
    ) {
      setError(t("activities.saveChangesBeforeSending"));
      return;
    }
    if (savedSendSnapshot.classIds.length === 0 && !confirmSchoolWide) {
      setError(t("activities.confirmSchoolWide"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      await axios.post(`/api/activities/${activity.id}/send`, {
        notifyGuardians,
        notifyStaff,
        message,
        confirmSchoolWide,
        activityVersion: savedSendSnapshot.activityVersion,
        idempotencyKey: sendKey.current ??= crypto.randomUUID(),
      });
      setError(null);
      setSentNotice(true);
      sendKey.current = null;
    } catch (err) {
      setError(describeApiError(err, t("activities.sendFailedStored")));
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    if (!activity) return;
    setDeleting(true);
    setError(null);
    try {
      await axios.delete(`/api/activities/${activity.id}`);
      onSaved();
      onClose();
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? err.response.data.error
          : t("common.error");
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  const dismissBlocked = saving || uploadingImage || sending || deleting;
  const imagePreviewElement = imagePreview ? (
    <img
      src={imagePreview}
      alt={t("common.preview")}
      className="h-40 w-full object-cover"
    />
  ) : null;

  useEffect(() => {
    onDismissBlockedChange?.(dismissBlocked);
  }, [dismissBlocked, onDismissBlockedChange]);

  useEffect(
    () => () => {
      onDismissBlockedChange?.(false);
    },
    [onDismissBlockedChange]
  );

  const body = (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Inside `body`, not beside it. This block used to sit after the
                  `if (embedded) return body` line, so the calendar-embedded
                  copy of this form reported nothing at all — including the
                  details fetch failing, which re-enables Save with a blank
                  teacher and no invited classes and lets a save wipe both. */}
              {error && (
                <div role="alert" className="flex items-center justify-between gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  <span>{error}</span>
                  {isEdit && detailsStatus === "error" && activity && (
                    <button
                      type="button"
                      onClick={() => loadActivityDetails(activity.id)}
                      className="shrink-0 underline"
                    >
                      {t("common.retry")}
                    </button>
                  )}
                </div>
              )}

              {/* Activity name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.name")}
                </label>
                <input
                  type="text"
                  {...register("name", { required: true })}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651] ${
                    errors.name ? "border-red-400" : "border-gray-200"
                  }`}
                />
              </div>
  
              {/* Teacher */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.teacher")}
                </label>
                {loadingTeachers ? (
                  <div className="text-xs text-gray-400">{t("common.loading")}</div>
                ) : (
                  <select
                    {...register("teacherId", { required: true })}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651] ${
                      errors.teacherId ? "border-red-400" : "border-gray-200"
                    }`}
                  >
                    <option value="">{t("common.select")}</option>
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
  
              {/* Children count + Group row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("home.activityForm.childrenCount")}
                  </label>
                  <input
                    type="number"
                    min={0}
                    {...register("childrenCount", { setValueAs: emptyToZero })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("common.academicStage")}
                  </label>
                  <select
                    {...register("stageId")}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]"
                  >
                    <option value="">{t("common.noStage")}</option>
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stageName(stage)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
  
              {/* Period */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.period")}
                </label>
                <select
                  {...register("period")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]"
                >
                  <option value="MORNING">{t("periods.MORNING")}</option>
                  <option value="EVENING">{t("periods.EVENING")}</option>
                </select>
              </div>
  
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" {...register("allDay")} className="accent-[#F64651]" />
                {t("calendar.allDay")}
              </label>

              {/* Calendar dates stay date-only; wall-clock times are resolved
                  with the browser's IANA zone immediately before saving. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("home.activityForm.startDate")}
                  </label>
                  <input
                    type="date"
                    {...register("startDate", { required: true })}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651] ${errors.startDate ? "border-red-400" : "border-gray-200"}`}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("home.activityForm.endDate")}
                  </label>
                  <input
                    type="date"
                    {...register("endDate", { required: true })}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651] ${errors.endDate ? "border-red-400" : "border-gray-200"}`}
                    dir="ltr"
                  />
                </div>
              </div>
              {!allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("activities.startTime")}
                    </label>
                    <input
                      type="time"
                      {...register("startTime", { required: !allDay })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("activities.endTime")}
                    </label>
                    <input
                      type="time"
                      {...register("endTime", { required: !allDay })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}
  
              {/* Fee */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.fee")}
                </label>
                <div className="relative" dir="ltr">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    {...register("fee", { setValueAs: emptyToZero })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 pe-12 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651]"
                  />
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                    {t("common.sar")}
                  </span>
                </div>
              </div>
  
              {/* Image upload with preview */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.image")}
                </label>
                <PermissionGate
                  permission="schedule.manage"
                  fallback={imagePreviewElement ? (
                    <div className="overflow-hidden rounded-xl">{imagePreviewElement}</div>
                  ) : null}
                >
                  <div
                    className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-[#F64651] transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {imagePreview ? (
                      imagePreviewElement
                    ) : (
                      <div className="h-32 flex flex-col items-center justify-center gap-2 text-gray-400">
                        <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl">
                          🖼
                        </div>
                        <span className="text-xs">{t("classes.uploadHint")}</span>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png"
                    className="hidden"
                    onChange={handleImageChange}
                  />
                  {uploadingImage && (
                    <p className="text-xs text-gray-400 mt-1">{t("studentProfile.uploading")}</p>
                  )}
                  {imagePreview && (
                    <button
                      type="button"
                      onClick={() => { setImageUrl(null); setImagePreview(null); }}
                      className="text-xs text-red-500 hover:underline mt-1"
                    >
                      {t("common.deleteImage")}
                    </button>
                  )}
                </PermissionGate>
              </div>
  
              {/* Message */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("home.activityForm.message")}
                </label>
                <textarea
                  {...register("message")}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651] resize-none"
                />
              </div>
  
              {/* Classes checklist */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("home.activityForm.classes")}
                </label>
                {loadingClasses ? (
                  <div className="text-xs text-gray-400">{t("common.loading")}</div>
                ) : classesFailed ? (
                  <div className="text-xs text-red-600">{t("classes.loadFailed")}</div>
                ) : classes.length === 0 ? (
                  <div className="text-xs text-gray-400">{t("classes.noneYet")}</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border border-gray-100 rounded-lg">
                    {classes.map((cls) => (
                      <label
                        key={cls.id}
                        className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={selectedClassIds.includes(cls.id)}
                          onChange={() => toggleClass(cls.id)}
                          className="accent-[#F64651]"
                        />
                        {cls.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
  
              {/* Both modes. The decision is made while writing the activity, so
                  hiding the choice until the second visit put it where it is no
                  longer being made. */}
              {(
                <label className="flex items-start gap-2 text-sm text-gray-600 pt-2">
                  <input
                    type="checkbox"
                    checked={notifyGuardians}
                    onChange={(e) => setNotifyGuardians(e.target.checked)}
                    className="accent-[#F64651] mt-0.5"
                  />
                  <span>
                    {t("activities.notifyGuardians")}
                    <span className="block text-xs text-gray-400">
                      {t("activities.notifyHint")}
                    </span>
                  </span>
                </label>
              )}
  
              {sentNotice && (
                <p role="status" className="text-sm text-success-text bg-success-bg rounded-xl px-3 py-2">
                  {t("activities.sent")}
                </p>
              )}
  
              {(
                <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyStaff}
                    onChange={(e) => setNotifyStaff(e.target.checked)}
                    className="accent-[#F64651] mt-0.5"
                  />
                  <span>
                    {t("activities.notifyStaff")}
                    <span className="block text-xs text-gray-400">
                      {t("activities.notifyStaffHint")}
                    </span>
                  </span>
                </label>
              )}

              {(notifyGuardians || notifyStaff) && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                  <p className="font-medium">{t("activities.audiencePreview")}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {!savedSendSnapshot
                      ? t("common.loading")
                      : savedSendSnapshot.classIds.length > 0
                      ? t("activities.selectedClassesAudience", { n: String(savedSendSnapshot?.classIds.length ?? 0) })
                      : t("activities.allClassesAudience")}
                  </p>
                  {savedSendSnapshot?.classIds.length === 0 && (
                    <label className="mt-2 flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={confirmSchoolWide}
                        onChange={(event) => setConfirmSchoolWide(event.target.checked)}
                        className="mt-0.5 accent-[#F64651]"
                      />
                      <span>{t("activities.confirmAllClasses")}</span>
                    </label>
                  )}
                </div>
              )}
  
              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                <PermissionGate permission="schedule.manage">
                <button
                  type="submit"
                  disabled={saving || uploadingImage || (isEdit && detailsStatus !== "ready")}
                  className="flex-1 bg-[#F64651] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#D93A44] transition-colors disabled:opacity-60"
                >
                  {/* Blocked while the teacher and class list are still loading —
                      submitting early would save the blanks this fix removed. */}
                  {saving || loadingDetails ? t("common.loading") : t("common.save")}
                </button>
                </PermissionGate>
  
                {/* Sends for an already-saved programme without re-saving it.
                    The handler existed with no button after the form was
                    extracted for embedding, so the whole "send it a week later"
                    path was unreachable. */}
                {isEdit && (
                  <PermissionGate permission="schedule.manage">
                  <button
                    type="button"
                    onClick={handleSendNow}
                    disabled={sending || saving || loadingDetails}
                    title={t("activities.sendNowHint")}
                    className="px-4 py-2.5 border border-[#2F96A6] text-[#2F96A6] rounded-lg text-sm font-semibold hover:bg-[#E0F7FA] transition-colors disabled:opacity-60"
                  >
                    {sending ? t("common.loading") : t("activities.sendNow")}
                  </button>
                  </PermissionGate>
                )}

                {isEdit && (
                  <PermissionGate permission="schedule.delete">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-4 py-2.5 border border-red-500 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-60"
                  >
                    {deleting ? t("common.loading") : t("home.activityForm.deleteActivity")}
                  </button>
                  </PermissionGate>
                )}
              </div>
            </form>
  );

  // Embedded: the caller supplies the dialog and the heading.
  if (embedded) return body;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => closeDialogOnOpenChange(nextOpen, dismissBlocked, onClose)}
    >
        <DialogContent dismissBlocked={dismissBlocked} overlayClassName="bg-black/40" className="max-w-xl p-6">
          <DialogDescription className="sr-only">{t("activities.modalLabel")}</DialogDescription>
          <DialogHeader className="mb-5 items-center">
            <DialogTitle>{t("home.activityForm.title")}</DialogTitle>
            <DialogClose asChild>
              <button
                type="button"
                disabled={dismissBlocked}
                aria-label={t("common.close")}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </DialogClose>
          </DialogHeader>

          {body}
        </DialogContent>
    </Dialog>
  );
}
