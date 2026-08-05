"use client";

import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";
import * as Dialog from "@radix-ui/react-dialog";

import { VariableReference } from "@/components/ui/VariableReference";
import { describeApiError } from "@/lib/api-error";
import type { Activity } from "./ActivityGrid";
import { useT } from "@/lib/i18n-provider";
import { useAcademicStages, useStageName } from "@/lib/use-academic-stages";

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
}

interface ActivityFormValues {
  name: string;
  teacherId: string;
  childrenCount: number;
  stageId: string;
  period: "MORNING" | "EVENING";
  startDate: string;
  endDate: string;
  fee: number;
  message: string;
  classIds: string[];
}

interface ActivityFormModalProps {
  open: boolean;
  onClose: () => void;
  activity: Activity | null;
  onSaved: () => void;
}

export function ActivityFormModal({
  open,
  onClose,
  activity,
  onSaved,
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
  const [loadingDetails, setLoadingDetails] = useState(false);
  // Opt-in, not automatic. Every edit used to fire the notification endpoint, so
  // fixing a typo in the title re-emailed every guardian in every invited class.
  const [notifyGuardians, setNotifyGuardians] = useState(false);
  /* Staff were never told. The message went to guardians only, so the teacher
     expected to run the activity found out when the children turned up. */
  const [notifyStaff, setNotifyStaff] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Inserts at the caret, not at the end.
   *
   * Appending would put the token after the full stop of whatever was already
   * typed, so the writer has to cut and paste it back into place — which is the
   * work this button exists to remove.
   */
  function insertVariable(token: string) {
    const field = messageRef.current;
    const current = getValues("message") ?? "";
    if (!field) {
      setValue("message", `${current}${token}`, { shouldDirty: true });
      return;
    }
    const start = field.selectionStart ?? current.length;
    const end = field.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    setValue("message", next, { shouldDirty: true });
    // After React has written the new value, or the caret lands on stale text.
    requestAnimationFrame(() => {
      field.focus();
      const caret = start + token.length;
      field.setSelectionRange(caret, caret);
    });
  }
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
      fee: 0,
      message: "",
      classIds: [],
    },
  });

  const selectedClassIds = watch("classIds") ?? [];

  useEffect(() => {
    if (!open) return;

    setLoadingTeachers(true);
    axios
      .get<Teacher[]>("/api/teachers")
      .then((r) => setTeachers(r.data))
      .catch(() => setTeachers([]))
      .finally(() => setLoadingTeachers(false));

    setLoadingClasses(true);
    setClassesFailed(false);
    axios
      .get<ClassItem[]>("/api/classes")
      .then((r) => {
        setClasses(r.data);
        setClassesFailed(false);
      })
      .catch(() => {
        setClasses([]);
        setClassesFailed(true);
      })
      .finally(() => setLoadingClasses(false));
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

    if (open && activity) {
      reset({
        name: activity.name ?? "",
        teacherId: "",
        childrenCount: activity.childrenCount ?? 0,
        // The list carries the stage nested; the form needs only its id.
        stageId: activity.stage?.id ?? "",
        period: activity.period ?? "MORNING",
        startDate: activity.startDate ? activity.startDate.slice(0, 10) : "",
        endDate: activity.endDate ? activity.endDate.slice(0, 10) : "",
        fee: activity.fee ?? 0,
        message: activity.message ?? "",
        classIds: [],
      });
      setImageUrl(activity.imageUrl ?? null);
      setImagePreview(activity.imageUrl ?? null);

      let cancelled = false;
      setLoadingDetails(true);
      axios
        .get<ActivityDetails>(`/api/activities/${activity.id}`)
        .then((r) => {
          if (cancelled) return;
          setValue("teacherId", r.data.teacherId ?? "");
          setValue(
            "classIds",
            (r.data.activityInvites ?? []).map((invite) => invite.classId)
          );
        })
        .catch(() => {
          if (!cancelled) setError(t("activities.loadFailed"));
        })
        .finally(() => {
          if (!cancelled) setLoadingDetails(false);
        });
      return () => {
        cancelled = true;
      };
    } else if (open && !activity) {
      reset({
        name: "",
        teacherId: "",
        childrenCount: 0,
        stageId: "",
        period: "MORNING",
        startDate: "",
        endDate: "",
        fee: 0,
        message: "",
        classIds: [],
      });
      setImageUrl(null);
      setImagePreview(null);
    }
  }, [open, activity, reset, setValue, t]);

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
    setSaving(true);
    setError(null);
    try {
      const payload = { ...data, imageUrl };

      /**
       * The id to notify about, whichever branch we took.
       *
       * Creating used to POST and stop there while the button read "save and
       * send" — so a new activity announced itself to nobody, and the only way
       * to find out was that no guardian mentioned it. The create branch now
       * honours the same two checkboxes the edit branch does.
       */
      let targetId: string | null = null;
      if (isEdit && activity) {
        await axios.put(`/api/activities/${activity.id}`, payload);
        targetId = activity.id;
      } else {
        const created = await axios.post<{ id: string }>("/api/activities", payload);
        targetId = created.data?.id ?? null;
      }

      // Only when asked. Every edit used to fire this, so fixing a typo in the
      // title re-messaged every guardian in every invited class.
      if (targetId && (notifyGuardians || notifyStaff)) {
        await axios.post(`/api/activities/${targetId}/send`, {
          notifyGuardians,
          notifyStaff,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? err.response.data.error
          : t("common.error");
      setError(message);
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
    if (!notifyGuardians && !notifyStaff) {
      setError(t("activities.pickAudience"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      await axios.post(`/api/activities/${activity.id}/send`, {
        notifyGuardians,
        notifyStaff,
      });
      setError(null);
      setSentNotice(true);
    } catch (err) {
      setError(describeApiError(err, t("home.activityForm.sendFailed")));
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

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          dir="rtl"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-modal w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 focus:outline-none animate-scale-in"
        >
          <Dialog.Description className="sr-only">
            {t("activities.modalLabel")}
          </Dialog.Description>
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-lg font-bold text-[#111111]">
              {t("home.activityForm.title")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
                ×
              </button>
            </Dialog.Close>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                  {...register("childrenCount", { valueAsNumber: true })}
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

            {/* Start + End dates row */}
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

            {/* Fee */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("home.activityForm.fee")}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  {...register("fee", { valueAsNumber: true })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651] pl-12"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                  {t("common.sar")}
                </span>
              </div>
            </div>

            {/* Image upload with preview */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("home.activityForm.image")}
              </label>
              <div
                className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-[#F64651] transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt={t("common.preview")}
                    className="w-full h-40 object-cover"
                  />
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
            </div>

            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("home.activityForm.message")}
              </label>
              <textarea
                {...register("message")}
                ref={(element) => {
                  register("message").ref(element);
                  messageRef.current = element;
                }}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F64651] resize-none"
              />
              <VariableReference mode="full" onInsert={insertVariable} />
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

            {/* Notification opt-in — edit only. Creating an activity has its own
                send step, and an unticked box here means "save quietly". */}
            {isEdit && (
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

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <button
                type="submit"
                disabled={saving || uploadingImage || loadingDetails}
                className="flex-1 bg-[#F64651] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#D93A44] transition-colors disabled:opacity-60"
              >
                {/* Blocked while the teacher and class list are still loading —
                    submitting early would save the blanks this fix removed. */}
                {saving || loadingDetails
                  ? t("common.loading")
                  : notifyGuardians || notifyStaff
                    ? t("home.activityForm.saveAndSend")
                    : t("common.save")}
              </button>

              {isEdit && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2.5 border border-red-500 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-60"
                >
                  {deleting ? t("common.loading") : t("home.activityForm.deleteActivity")}
                </button>
              )}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
