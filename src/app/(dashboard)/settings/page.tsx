"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { DeliveryStatusBadge } from "@/components/ui/StatusBadge";

import { isPasswordAcceptable, PASSWORD_MIN_MESSAGE } from "@/lib/password-policy";
import { PasswordRules } from "@/components/ui/PasswordRules";
import { useT, useLocale } from "@/lib/i18n-provider";
import { AcademicStagesPanel } from "@/components/settings/AcademicStagesPanel";
import { formatAst } from "@/lib/datetime";
import { describeApiError } from "@/lib/api-error";
import { usePermissions } from "@/lib/use-permissions";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { SchoolLogo } from "@/components/layout/SchoolLogo";

// ── Types ────────────────────────────────────────────────────────────────────

interface SettingsData {
  settings: {
    hourlyLateFee: number;
    dailyStudentFee: number;
    weeklyStudentFee: number | null;
    monthlyStudentFee: number;
    yearlyStudentFee: number | null;
    reminderTemplate: string;
  };
  schoolName: string;
  logoUrl: string | null;
  plan: string;
  schoolEmail: string;
  loginEmail: string;
  teacherMorningCheckinTime: string;
  teacherMorningCheckoutTime: string;
  teacherEveningCheckinTime: string;
  teacherEveningCheckoutTime: string;
  studentMorningCheckinTime: string;
  studentMorningCheckoutTime: string;
  studentEveningCheckinTime: string;
  studentEveningCheckoutTime: string;
  commercialRegistration: string;
  vatNumber: string;
  contactNumber: string;
  address: string;
  phoneNumber: string;
  twoFaEnabled: boolean;
}

interface TrashStudent {
  id: string;
  name: string;
  deletedAt: string;
}
interface TrashTeacher {
  id: string;
  name: string;
  deletedAt: string;
}
interface TrashClass {
  id: string;
  name: string;
  deletedAt: string;
}

interface NotificationLog {
  id: string;
  recipientName: string;
  type: "WHATSAPP" | "EMAIL";
  content: string;
  status: "SENT" | "FAILED";
  sentAt: string;
}

// ── Section wrapper ─────────────────────────────────────────────────────────

function SettingsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const order: Record<string, number> = {
    "school-info": 10,
    "school-hours": 20,
    fees: 30,
    "academic-stages": 40,
    password: 50,
    security: 51,
    subscription: 60,
    "message-template": 70,
    "notification-log": 80,
    trash: 90,
  };
  return (
    <section id={id} style={{ order: order[id] ?? 100 }} className="bg-white rounded-xl shadow-md p-6 space-y-4">
      <h2 className="text-base font-bold text-[#111111] border-b border-gray-100 pb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function PeriodScheduleFields({
  title, checkinLabel, checkoutLabel, checkin, checkout, onCheckin, onCheckout, disabled,
}: {
  title: string;
  checkinLabel: string;
  checkoutLabel: string;
  checkin: string;
  checkout: string;
  onCheckin: (value: string) => void;
  onCheckout: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="rounded-xl border border-gray-100 p-4">
      <legend className="px-2 text-sm font-semibold text-gray-700">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={checkinLabel}>
          <input type="time" value={checkin} onChange={(event) => onCheckin(event.target.value)} disabled={disabled} dir="ltr" className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4f00c1]" />
        </FormField>
        <FormField label={checkoutLabel}>
          <input type="time" value={checkout} onChange={(event) => onCheckout(event.target.value)} disabled={disabled} dir="ltr" className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4f00c1]" />
        </FormField>
      </div>
    </fieldset>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { locale } = useLocale();
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const router = useRouter();
  const { can } = usePermissions();
  const canManageSettings = can("settings.manage");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("school");

  // Settings state
  const [settingsData, setSettingsData] = useState<SettingsData | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  type SaveSection = "hours" | "fees" | "notifications";
  const [savingSection, setSavingSection] = useState<SaveSection | null>(null);
  const [sectionFeedback, setSectionFeedback] = useState<
    Partial<Record<SaveSection, { ok: boolean; text: string }>>
  >({});

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [loginEmail, setLoginEmail] = useState("");
  const [hourlyLateFee, setHourlyLateFee] = useState(0);
  const [dailyStudentFee, setDailyStudentFee] = useState(0);
  const [weeklyStudentFee, setWeeklyStudentFee] = useState<number | "">("");
  const [monthlyStudentFee, setMonthlyStudentFee] = useState(0);
  const [yearlyStudentFee, setYearlyStudentFee] = useState<number | "">("");
  const [reminderTemplate, setReminderTemplate] = useState("");

  // School hours state
  const [teacherMorningCheckinTime, setTeacherMorningCheckinTime] = useState("");
  const [teacherMorningCheckoutTime, setTeacherMorningCheckoutTime] = useState("");
  const [teacherEveningCheckinTime, setTeacherEveningCheckinTime] = useState("");
  const [teacherEveningCheckoutTime, setTeacherEveningCheckoutTime] = useState("");
  const [studentMorningCheckinTime, setStudentMorningCheckinTime] = useState("");
  const [studentMorningCheckoutTime, setStudentMorningCheckoutTime] = useState("");
  const [studentEveningCheckinTime, setStudentEveningCheckinTime] = useState("");
  const [studentEveningCheckoutTime, setStudentEveningCheckoutTime] = useState("");

  // 2FA / security state
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activateStep, setActivateStep] = useState<"confirm" | "otp">("confirm");
  const [activateSessionId, setActivateSessionId] = useState("");
  const [activateOtp, setActivateOtp] = useState("");
  const [activateError, setActivateError] = useState("");
  const [activateLoading, setActivateLoading] = useState(false);
  const [twoFaSuccessMsg, setTwoFaSuccessMsg] = useState("");

  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivatePassword, setDeactivatePassword] = useState("");
  const [deactivateError, setDeactivateError] = useState("");
  const [deactivateLoading, setDeactivateLoading] = useState(false);

  // Trash state
  const [trashTab, setTrashTab] = useState<"students" | "teachers" | "classes">("students");
  const [trashStudents, setTrashStudents] = useState<TrashStudent[]>([]);
  const [trashTeachers, setTrashTeachers] = useState<TrashTeacher[]>([]);
  const [trashClasses, setTrashClasses] = useState<TrashClass[]>([]);
  const [loadingTrash, setLoadingTrash] = useState(false);
  const [trashActionId, setTrashActionId] = useState<string | null>(null);
  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState<{ type: string; id: string } | null>(null);
  const [showRestoreAllConfirm, setShowRestoreAllConfirm] = useState(false);
  const [restoringAll, setRestoringAll] = useState(false);
  const [restoreAllMsg, setRestoreAllMsg] = useState("");

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Notification logs state
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsSkip, setLogsSkip] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);
  const [confirmDeleteLogId, setConfirmDeleteLogId] = useState<string | null>(null);
  const [confirmBulkDeleteLog, setConfirmBulkDeleteLog] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const [deletingBulkLog, setDeletingBulkLog] = useState(false);
  const PAGE_SIZE = 20;

  /**
   * "Now", captured once at mount.
   *
   * `daysRemaining` used to call `Date.now()` while rendering, which makes the
   * render impure: two renders of the same data could disagree, and React is
   * free to render whenever it likes. A countdown measured in days does not
   * need to tick anyway — the screen is reopened long before the number moves.
   */
  const [mountedAt] = useState(() => Date.now());

  // Fetch settings.
  //
  // No `setLoadingSettings(true)` here: the state already starts true and this
  // effect runs once. A synchronous setState in an effect body schedules a
  // second render before the first has painted, which is what
  // `react-hooks/set-state-in-effect` is warning about.
  useEffect(() => {
    axios
      .get<SettingsData>("/api/settings")
      .then((res) => {
        const d = res.data;
        setSettingsData(d);
        setLogoUrl(d.logoUrl ?? null);
        setLoginEmail(d.loginEmail ?? "");
        setHourlyLateFee(d.settings.hourlyLateFee);
        setDailyStudentFee(d.settings.dailyStudentFee);
        setWeeklyStudentFee(d.settings.weeklyStudentFee ?? "");
        setMonthlyStudentFee(d.settings.monthlyStudentFee);
        setYearlyStudentFee(d.settings.yearlyStudentFee ?? "");
        setReminderTemplate(d.settings.reminderTemplate);
        setTeacherMorningCheckinTime(d.teacherMorningCheckinTime ?? "");
        setTeacherMorningCheckoutTime(d.teacherMorningCheckoutTime ?? "");
        setTeacherEveningCheckinTime(d.teacherEveningCheckinTime ?? "");
        setTeacherEveningCheckoutTime(d.teacherEveningCheckoutTime ?? "");
        setStudentMorningCheckinTime(d.studentMorningCheckinTime ?? "");
        setStudentMorningCheckoutTime(d.studentMorningCheckoutTime ?? "");
        setStudentEveningCheckinTime(d.studentEveningCheckinTime ?? "");
        setStudentEveningCheckoutTime(d.studentEveningCheckoutTime ?? "");
        setTwoFaEnabled(d.twoFaEnabled ?? false);
        setSettingsError("");
      })
      .catch(() => setSettingsError(t("settings.loadFailed")))
      .finally(() => setLoadingSettings(false));
  }, [t]);

  // Fetch initial notification logs (reminders + other, exclude activity logs).
  // Starts true in useState — see the note on the settings fetch above.
  useEffect(() => {
    axios
      .get<{ logs: NotificationLog[]; total: number }>(
        `/api/notifications?skip=0&take=${PAGE_SIZE}&source=other`
      )
      .then((res) => {
        setLogs(res.data.logs);
        setLogsTotal(res.data.total);
        setLogsSkip(res.data.logs.length);
      })
      .catch(() => {})
      .finally(() => setLoadingLogs(false));
  }, []);

  async function handleDeleteOneLog(id: string) {
    setDeletingLogId(id);
    try {
      await axios.delete(`/api/notifications/log/${id}`);
      setLogs((prev) => prev.filter((l) => l.id !== id));
      setLogsTotal((t) => t - 1);
    } catch { /* silent */ }
    finally {
      setDeletingLogId(null);
      setConfirmDeleteLogId(null);
    }
  }

  async function handleDeleteBulkLog() {
    setDeletingBulkLog(true);
    try {
      await axios.delete(`/api/notifications/log/bulk?source=other`);
      setLogs([]);
      setLogsTotal(0);
      setLogsSkip(0);
    } catch { /* silent */ }
    finally {
      setDeletingBulkLog(false);
      setConfirmBulkDeleteLog(false);
    }
  }

  async function handleLoadMoreLogs() {
    setLoadingMoreLogs(true);
    try {
      const res = await axios.get<{ logs: NotificationLog[]; total: number }>(
        `/api/notifications?skip=${logsSkip}&take=${PAGE_SIZE}&source=other`
      );
      setLogs((prev) => [...prev, ...res.data.logs]);
      setLogsSkip((prev) => prev + res.data.logs.length);
      setLogsTotal(res.data.total);
    } catch {
      // silently ignore
    } finally {
      setLoadingMoreLogs(false);
    }
  }

  const nullable = (value: string) => value.trim() || null;

  function changed(payload: Record<string, unknown>, key: string, next: unknown, current: unknown) {
    if (next !== current) payload[key] = next;
  }

  function sectionPayload(section: SaveSection): Record<string, unknown> {
    if (!settingsData) return {};
    const payload: Record<string, unknown> = {};
    if (section === "hours") {
      changed(payload, "teacherMorningCheckinTime", nullable(teacherMorningCheckinTime), nullable(settingsData.teacherMorningCheckinTime ?? ""));
      changed(payload, "teacherMorningCheckoutTime", nullable(teacherMorningCheckoutTime), nullable(settingsData.teacherMorningCheckoutTime ?? ""));
      changed(payload, "teacherEveningCheckinTime", nullable(teacherEveningCheckinTime), nullable(settingsData.teacherEveningCheckinTime ?? ""));
      changed(payload, "teacherEveningCheckoutTime", nullable(teacherEveningCheckoutTime), nullable(settingsData.teacherEveningCheckoutTime ?? ""));
      changed(payload, "studentMorningCheckinTime", nullable(studentMorningCheckinTime), nullable(settingsData.studentMorningCheckinTime ?? ""));
      changed(payload, "studentMorningCheckoutTime", nullable(studentMorningCheckoutTime), nullable(settingsData.studentMorningCheckoutTime ?? ""));
      changed(payload, "studentEveningCheckinTime", nullable(studentEveningCheckinTime), nullable(settingsData.studentEveningCheckinTime ?? ""));
      changed(payload, "studentEveningCheckoutTime", nullable(studentEveningCheckoutTime), nullable(settingsData.studentEveningCheckoutTime ?? ""));
    } else if (section === "fees") {
      changed(payload, "hourlyLateFee", hourlyLateFee, Number(settingsData.settings.hourlyLateFee));
      changed(payload, "dailyStudentFee", dailyStudentFee, Number(settingsData.settings.dailyStudentFee));
      changed(payload, "weeklyStudentFee", weeklyStudentFee === "" ? null : weeklyStudentFee, settingsData.settings.weeklyStudentFee);
      changed(payload, "monthlyStudentFee", monthlyStudentFee, Number(settingsData.settings.monthlyStudentFee));
      changed(payload, "yearlyStudentFee", yearlyStudentFee === "" ? null : yearlyStudentFee, settingsData.settings.yearlyStudentFee);
    } else {
      changed(payload, "reminderTemplate", reminderTemplate, settingsData.settings.reminderTemplate);
    }
    return payload;
  }

  function commitSection(section: SaveSection) {
    setSettingsData((current) => {
      if (!current) return current;
      if (section === "hours") {
        return {
          ...current,
          teacherMorningCheckinTime,
          teacherMorningCheckoutTime,
          teacherEveningCheckinTime,
          teacherEveningCheckoutTime,
          studentMorningCheckinTime,
          studentMorningCheckoutTime,
          studentEveningCheckinTime,
          studentEveningCheckoutTime,
        };
      }
      if (section === "fees") {
        return {
          ...current,
          settings: { ...current.settings, hourlyLateFee, dailyStudentFee, weeklyStudentFee: weeklyStudentFee === "" ? null : weeklyStudentFee, monthlyStudentFee, yearlyStudentFee: yearlyStudentFee === "" ? null : yearlyStudentFee },
        };
      }
      return { ...current, settings: { ...current.settings, reminderTemplate } };
    });
  }

  async function handleSaveSection(section: SaveSection) {
    if (!canManageSettings || savingSection) return;
    const payload = sectionPayload(section);
    setSectionFeedback((current) => ({ ...current, [section]: undefined }));
    if (Object.keys(payload).length === 0) {
      setSectionFeedback((current) => ({
        ...current,
        [section]: { ok: true, text: t("settings.noChanges") },
      }));
      return;
    }
    setSavingSection(section);
    try {
      await axios.put("/api/settings", payload);
      commitSection(section);
      setSectionFeedback((current) => ({
        ...current,
        [section]: { ok: true, text: t("common.success") },
      }));
    } catch (error) {
      const code = axios.isAxiosError(error) ? error.response?.data?.code : null;
      const message = code === "INCOMPLETE_SCHEDULE"
        ? t("settings.incompleteSchedule")
        : code === "INVALID_SCHEDULE_RANGE"
          ? t("settings.invalidScheduleRange")
          : describeApiError(error, t("settings.saveFailed"));
      setSectionFeedback((current) => ({
        ...current,
        [section]: { ok: false, text: message },
      }));
    } finally {
      setSavingSection(null);
    }
  }

  function sectionSaveAction(section: SaveSection) {
    const feedback = sectionFeedback[section];
    if (!canManageSettings) return null;
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => void handleSaveSection(section)}
          disabled={savingSection !== null}
          className="rounded-lg bg-[#4f00c1] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3f009b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingSection === section ? t("common.loading") : t("settings.save")}
        </button>
        {feedback && (
          <p role={feedback.ok ? "status" : "alert"} className={`text-sm ${feedback.ok ? "text-success-text" : "text-red-700"}`}>
            {feedback.text}
          </p>
        )}
      </div>
    );
  }

  async function handleChangePassword() {
    setPasswordError("");
    setPasswordSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError(t("settings.fillAllFields"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("settings.passwordsDiffer"));
      return;
    }
    // Same rule and same wording as the server — a form that accepts 6 and a
    // route that requires 8 just produces an unexplained validation failure.
    if (!isPasswordAcceptable(newPassword)) {
      setPasswordError(PASSWORD_MIN_MESSAGE);
      return;
    }

    setSavingPassword(true);
    try {
      await axios.put("/api/settings/password", {
        currentPassword,
        newPassword,
      });
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
    } catch (err: unknown) {
      if (
        axios.isAxiosError(err) &&
        err.response?.data?.error === "Current password is incorrect"
      ) {
        setPasswordError(t("settings.currentPasswordWrong"));
      } else {
        setPasswordError(t("settings.passwordChangeFailed"));
      }
    } finally {
      setSavingPassword(false);
    }
  }

  // ── 2FA handlers ──────────────────────────────────────────────────────────

  function handleToggle2FA() {
    if (twoFaEnabled) {
      setDeactivatePassword("");
      setDeactivateError("");
      setShowDeactivateModal(true);
      return;
    }
    setActivateStep("confirm");
    setActivateOtp("");
    setActivateError("");
    setShowActivateModal(true);
  }

  async function handleSendActivationOtp() {
    setActivateLoading(true);
    setActivateError("");
    try {
      const res = await axios.post<{ twoFaSessionId: string }>("/api/settings/2fa/send-activation-otp");
      setActivateSessionId(res.data.twoFaSessionId);
      setActivateStep("otp");
    } catch {
      setActivateError(t("settings.twoFa.sendFailed"));
    } finally {
      setActivateLoading(false);
    }
  }

  async function handleConfirmActivation() {
    setActivateLoading(true);
    setActivateError("");
    try {
      await axios.post("/api/settings/2fa/activate", {
        twoFaSessionId: activateSessionId,
        otp_code: activateOtp,
      });
      setShowActivateModal(false);
      setTwoFaEnabled(true);
      setTwoFaSuccessMsg(t("settings.twoFa.enabled"));
      setTimeout(() => setTwoFaSuccessMsg(""), 4000);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setActivateError(err.response.data.error);
      } else {
        setActivateError(t("settings.twoFa.wrongCode"));
      }
    } finally {
      setActivateLoading(false);
    }
  }

  async function handleDeactivate2FA() {
    setDeactivateLoading(true);
    setDeactivateError("");
    try {
      await axios.post("/api/settings/2fa/deactivate", { password: deactivatePassword });
      setShowDeactivateModal(false);
      setTwoFaEnabled(false);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setDeactivateError(err.response.data.error);
      } else {
        setDeactivateError(t("settings.genericError"));
      }
    } finally {
      setDeactivateLoading(false);
    }
  }

  // ── Trash handlers ────────────────────────────────────────────────────────

  async function loadTrash(tab: "students" | "teachers" | "classes") {
    setLoadingTrash(true);
    // Belongs to the tab being left, not to the one being loaded — a "restored
    // 4 children" message must not sit above the classes list.
    setRestoreAllMsg("");
    try {
      const res = await axios.get(`/api/trash/${tab}`);
      if (tab === "students") setTrashStudents(res.data.items ?? res.data);
      if (tab === "teachers") setTrashTeachers(res.data.items ?? res.data);
      if (tab === "classes") setTrashClasses(res.data.items ?? res.data);
    } catch {
      // silent
    } finally {
      setLoadingTrash(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    axios
      .get(`/api/trash/${trashTab}`, { signal: controller.signal })
      .then((res) => {
        if (trashTab === "students") setTrashStudents(res.data.items ?? res.data);
        if (trashTab === "teachers") setTrashTeachers(res.data.items ?? res.data);
        if (trashTab === "classes") setTrashClasses(res.data.items ?? res.data);
      })
      .catch((requestError: unknown) => {
        if (!axios.isCancel(requestError)) setSettingsError(t("settings.loadFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTrash(false);
      });
    return () => controller.abort();
  }, [trashTab, t]);

  function selectTrashTab(tab: "students" | "teachers" | "classes") {
    setLoadingTrash(true);
    setRestoreAllMsg("");
    setTrashTab(tab);
  }

  function closePasswordForm() {
    if (savingPassword) return;
    setShowPasswordForm(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
  }

  const trashTypeSingular: Record<"students" | "teachers" | "classes", string> = {
    students: "student",
    teachers: "teacher",
    classes: "class",
  };

  async function handleRestore(type: "students" | "teachers" | "classes", id: string) {
    setTrashActionId(id);
    try {
      await axios.post(`/api/trash/restore/${trashTypeSingular[type]}/${id}`);
      await loadTrash(type);
    } catch {
      alert(t("settings.restoreFailed"));
    } finally {
      setTrashActionId(null);
    }
  }

  async function handleRestoreAll() {
    setRestoringAll(true);
    setRestoreAllMsg("");
    try {
      if (trashTab === "students") {
        const res = await axios.post<{ restored: number; needsReassignment: number }>(
          "/api/trash/restore-all/students"
        );
        let msg = t("settings.restoredStudents", { n: String(res.data.restored) });
        if (res.data.needsReassignment > 0) {
          msg += t("settings.needsReassignment", { n: String(res.data.needsReassignment) });
        }
        setRestoreAllMsg(msg);
      } else if (trashTab === "teachers") {
        const res = await axios.post<{ restored: number }>("/api/trash/restore-all/teachers");
        setRestoreAllMsg(t("settings.restoredTeachers", { n: String(res.data.restored) }));
      } else {
        const res = await axios.post<{ restored: number }>("/api/trash/restore-all/classes");
        setRestoreAllMsg(t("settings.restoredClasses", { n: String(res.data.restored) }));
      }
      await loadTrash(trashTab);
    } catch {
      alert(t("settings.restoreFailed"));
    } finally {
      setRestoringAll(false);
      setShowRestoreAllConfirm(false);
    }
  }

  async function handlePermanentDelete() {
    if (!confirmPermanentDelete) return;
    const { type, id } = confirmPermanentDelete;
    setTrashActionId(id);
    try {
      await axios.delete(`/api/trash/permanent/${type}/${id}`);
      await loadTrash(trashTab);
    } catch {
      alert(t("settings.permanentDeleteFailed"));
    } finally {
      setTrashActionId(null);
      setConfirmPermanentDelete(null);
    }
  }

  function daysRemaining(deletedAt: string) {
    return Math.ceil(
      (new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000 - mountedAt) / (1000 * 60 * 60 * 24)
    );
  }

  function formatDMY(dateStr: string) {
    const d = new Date(dateStr);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const previousLogoUrl = logoUrl;
    setLogoUploading(true);
    // Immediate local preview
    const reader = new FileReader();
    reader.onload = (ev) => setLogoUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
    // Upload to server
    try {
      const form = new FormData();
      form.append("logo", file);
      const res = await axios.put<{ logoUrl: string }>("/api/settings/logo", form);
      setLogoUrl(res.data.logoUrl);
      router.refresh();
    } catch {
      setLogoUrl(previousLogoUrl);
      alert(t("settings.logoUploadFailed"));
    } finally {
      setLogoUploading(false);
      e.target.value = "";
    }
  }

  // ── Search filter ─────────────────────────────────────────────────────────

  const categories = useMemo(
    () => [
      { id: "school", title: t("settings.schoolInfo"), sections: ["school-info"] },
      { id: "hours", title: t("settings.schoolHours"), sections: ["school-hours"] },
      { id: "fees", title: t("settings.fees.title"), sections: ["fees", "subscription"] },
      { id: "stages", title: t("settings.stages.title"), sections: ["academic-stages"] },
      { id: "security", title: t("settings.accountSecurity"), sections: ["password", "security"] },
      { id: "notifications", title: t("settings.notificationsSection"), sections: ["message-template", "notification-log"] },
      { id: "data", title: t("settings.dataSection"), sections: ["trash"] },
    ],
    [t]
  );

  const filteredSections = useMemo(() => {
    if (!search.trim()) {
      return categories.find((category) => category.id === activeCategory)?.sections ?? [];
    }
    const q = search.toLowerCase();
    return categories
      .filter((category) => category.title.toLowerCase().includes(q))
      .flatMap((category) => category.sections);
  }, [activeCategory, categories, search]);

  function showSection(id: string) {
    return filteredSections.includes(id);
  }

  // ── Plan label ────────────────────────────────────────────────────────────

  const planLabels: Record<string, string> = {
    basic: t("plans.basic"),
    pro: t("plans.pro"),
    enterprise: t("plans.enterprise"),
  };
  const planLabel = planLabels[settingsData?.plan ?? ""] ?? settingsData?.plan ?? "—";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar title={t("settings.title")} />

      {/* Confirm delete one log */}
      {confirmDeleteLogId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">{t("settings.confirmDeleteLog")}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => handleDeleteOneLog(confirmDeleteLogId)} disabled={!!deletingLogId} className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60">{deletingLogId ? "..." : t("common.delete")}</button>
              <button onClick={() => setConfirmDeleteLogId(null)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Activate 2FA modal */}
      {showActivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 space-y-4">
            <h3 className="text-base font-bold text-[#111111] text-center">{t("settings.twoFa.enable")}</h3>

            {activateStep === "confirm" ? (
              <>
                <p className="text-sm text-gray-600 text-center">
                  {t("settings.codeWillBeSentTo")}
                </p>
                {activateError && (
                  <p className="text-red-600 text-sm text-center">{activateError}</p>
                )}
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleSendActivationOtp}
                    disabled={activateLoading}
                    className="px-5 py-2 bg-[#F64651] hover:bg-[#D93A44] text-white rounded-xl text-sm font-medium disabled:opacity-60"
                  >
                    {activateLoading ? "..." : t("settings.twoFa.sendCode")}
                  </button>
                  <button
                    onClick={() => setShowActivateModal(false)}
                    className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <FormField label={t("settings.twoFa.code")}>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={activateOtp}
                    onChange={(e) => setActivateOtp(e.target.value.replace(/\D/g, ""))}
                    dir="ltr"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-center text-lg tracking-[0.4em]"
                  />
                </FormField>
                {activateError && (
                  <p className="text-red-600 text-sm text-center">{activateError}</p>
                )}
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleConfirmActivation}
                    disabled={activateLoading || activateOtp.length !== 6}
                    className="px-5 py-2 bg-[#F64651] hover:bg-[#D93A44] text-white rounded-xl text-sm font-medium disabled:opacity-60"
                  >
                    {activateLoading ? "..." : t("common.confirm")}
                  </button>
                  <button
                    onClick={() => setShowActivateModal(false)}
                    className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Deactivate 2FA modal */}
      {showDeactivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 space-y-4">
            <h3 className="text-base font-bold text-[#111111] text-center">{t("settings.twoFa.disable")}</h3>
            <FormField label={t("settings.currentPassword")}>
              <input
                type="password"
                value={deactivatePassword}
                onChange={(e) => setDeactivatePassword(e.target.value)}
                dir="ltr"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                placeholder="••••••••"
              />
            </FormField>
            {deactivateError && (
              <p className="text-red-600 text-sm text-center">{deactivateError}</p>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleDeactivate2FA}
                disabled={deactivateLoading || !deactivatePassword}
                className="px-5 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium disabled:opacity-60"
              >
                {deactivateLoading ? "..." : t("settings.twoFa.disableAction")}
              </button>
              <button
                onClick={() => setShowDeactivateModal(false)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm permanent delete (trash) */}
      {confirmPermanentDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">
              {t("common.irreversibleConfirm")}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handlePermanentDelete}
                disabled={!!trashActionId}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {trashActionId ? "..." : t("settings.deleteForever")}
              </button>
              <button
                onClick={() => setConfirmPermanentDelete(null)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm restore all (trash) */}
      {showRestoreAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">
              {trashTab === "students"
                ? t("settings.restoreAllStudents", { n: String(trashStudents.length) })
                : trashTab === "teachers"
                ? t("settings.restoreAllTeachers", { n: String(trashTeachers.length) })
                : t("settings.restoreAllClasses", { n: String(trashClasses.length) })}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleRestoreAll}
                disabled={restoringAll}
                className="px-5 py-2 bg-[#F64651] text-white rounded-xl text-sm font-medium hover:bg-[#D93A44] disabled:opacity-60"
              >
                {restoringAll ? "..." : t("settings.restoreAll")}
              </button>
              <button
                onClick={() => setShowRestoreAllConfirm(false)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm bulk delete logs */}
      {confirmBulkDeleteLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">{t("settings.confirmClearLogs")}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={handleDeleteBulkLog} disabled={deletingBulkLog} className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60">{deletingBulkLog ? "..." : t("home.clearAll")}</button>
              <button onClick={() => setConfirmBulkDeleteLog(false)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6 p-4 sm:p-6">
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <label className="sr-only" htmlFor="settings-category">{t("settings.category")}</label>
          <select
            id="settings-category"
            value={activeCategory}
            onChange={(event) => setActiveCategory(event.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm md:hidden"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.title}</option>
            ))}
          </select>
          <nav aria-label={t("settings.category")} className="hidden flex-wrap gap-2 md:flex">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                aria-current={activeCategory === category.id ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${activeCategory === category.id ? "bg-[#4f00c1] text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {category.title}
              </button>
            ))}
          </nav>
        </div>
        {/* Search */}
        <div className="relative">
          <span className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            🔍
          </span>
          <input
            type="text"
            placeholder={t("settings.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pe-4 ps-9 text-sm focus:outline-none focus:ring-2 focus:ring-[#4f00c1]"
          />
        </div>

        {settingsError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {settingsError}
          </div>
        )}

        {loadingSettings ? (
          <div className="text-sm text-gray-400 py-8 text-center">
            {t("common.loading")}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-6">
            {/* ── School Info (merged with Legal Info) ──────────────── */}
            {showSection("school-info") && (
              <SettingsSection id="school-info" title={t("settings.schoolInfo")}>
                {/* Logo */}
                <FormField label={t("settings.logo")}>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-gray-100 border border-gray-200 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
                      {logoUrl ? (
                        <SchoolLogo src={logoUrl} name={settingsData?.schoolName ?? t("settings.logoTitle")} className="h-full w-full" />
                      ) : (
                        <span className="text-2xl">🏫</span>
                      )}
                    </div>
                    {canManageSettings && <div>
                      <label className={`cursor-pointer px-4 py-2 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-all inline-block ${logoUploading ? "opacity-50 pointer-events-none" : ""}`}>
                        {logoUploading ? t("settings.uploading") : t("common.upload")}
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept=".png,.svg,image/png,image/svg+xml"
                          className="hidden"
                          onChange={handleLogoUpload}
                        />
                      </label>
                      <p className="text-xs text-gray-400 mt-1.5">{t("settings.logoHint")}</p>
                    </div>}
                  </div>
                </FormField>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label={t("settings.schoolName")}>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm text-gray-700">{settingsData?.schoolName || "—"}</div>
                  </FormField>
                  <FormField label={t("settings.email")}>
                    <div dir="ltr" className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm text-gray-700">{settingsData?.schoolEmail || "—"}</div>
                  </FormField>
                  <FormField label={t("settings.commercialReg")}>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm text-gray-700">{settingsData?.commercialRegistration || "—"}</div>
                  </FormField>
                  <FormField label={t("settings.vatNumber")}>
                    <div dir="ltr" className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm text-gray-700">{settingsData?.vatNumber || "—"}</div>
                  </FormField>
                  <FormField label={t("settings.contactNumber")}>
                    <div dir="ltr" className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm text-gray-700">{settingsData?.contactNumber || "—"}</div>
                  </FormField>
                  <FormField label={t("settings.address")}>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm text-gray-700">{settingsData?.address || "—"}</div>
                  </FormField>
                  <FormField label={t("settings.phoneNumber")}>
                    <div dir="ltr" className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm text-gray-700">{settingsData?.phoneNumber || "—"}</div>
                  </FormField>
                </div>
                <p className="text-xs text-gray-500">{t("settings.schoolIdentityReadOnly")}</p>
              </SettingsSection>
            )}

            {/* ── School Hours ──────────────────────────────────────── */}
            {showSection("school-hours") && (
              <SettingsSection id="school-hours" title={t("settings.schoolHours")}>
                <div className="space-y-4">
                  <p className="text-xs text-gray-500">{t("settings.hoursHint")}</p>
                  <div>
                    <h3 className="text-sm font-semibold text-[#111111] mb-3">{t("settings.studentsLabel")}</h3>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <PeriodScheduleFields title={t("settings.morningPeriod")} checkinLabel={t("settings.shiftStartTime")} checkoutLabel={t("settings.shiftEndTime")} checkin={studentMorningCheckinTime} checkout={studentMorningCheckoutTime} onCheckin={setStudentMorningCheckinTime} onCheckout={setStudentMorningCheckoutTime} disabled={!canManageSettings} />
                      <PeriodScheduleFields title={t("settings.eveningPeriod")} checkinLabel={t("settings.shiftStartTime")} checkoutLabel={t("settings.shiftEndTime")} checkin={studentEveningCheckinTime} checkout={studentEveningCheckoutTime} onCheckin={setStudentEveningCheckinTime} onCheckout={setStudentEveningCheckoutTime} disabled={!canManageSettings} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#111111] mb-3">{t("settings.teachersLabel")}</h3>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <PeriodScheduleFields title={t("settings.morningPeriod")} checkinLabel={t("settings.shiftStartTime")} checkoutLabel={t("settings.shiftEndTime")} checkin={teacherMorningCheckinTime} checkout={teacherMorningCheckoutTime} onCheckin={setTeacherMorningCheckinTime} onCheckout={setTeacherMorningCheckoutTime} disabled={!canManageSettings} />
                      <PeriodScheduleFields title={t("settings.eveningPeriod")} checkinLabel={t("settings.shiftStartTime")} checkoutLabel={t("settings.shiftEndTime")} checkin={teacherEveningCheckinTime} checkout={teacherEveningCheckoutTime} onCheckin={setTeacherEveningCheckinTime} onCheckout={setTeacherEveningCheckoutTime} disabled={!canManageSettings} />
                    </div>
                  </div>
                  {sectionSaveAction("hours")}
                </div>
              </SettingsSection>
            )}

            {/* ── Change Password ────────────────────────────────────── */}
            {showSection("password") && (
              <SettingsSection
                id="password"
                title={t("settings.changePassword")}
              >
                {!showPasswordForm ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordSuccess(false);
                      setPasswordError("");
                      setCurrentPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                      setShowPasswordForm(true);
                    }}
                    className="rounded-xl bg-[#111111] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#253055]"
                  >
                    {t("settings.changePassword")}
                  </button>
                ) : (
                <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); void handleChangePassword(); }} className="space-y-4">
                <FormField label={t("settings.currentPassword")}>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    dir="ltr"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    placeholder="••••••••"
                  />
                </FormField>
                <FormField label={t("settings.newPassword")}>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    dir="ltr"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    placeholder="••••••••"
                  />
                  <PasswordRules value={newPassword} />
                </FormField>
                <FormField label={t("settings.confirmPassword")}>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    dir="ltr"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    placeholder="••••••••"
                  />
                </FormField>

                {passwordError && (
                  <p className="text-red-600 text-sm">{passwordError}</p>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={savingPassword}
                    className="px-6 py-2.5 bg-[#111111] hover:bg-[#253055] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {savingPassword ? t("common.loading") : t("settings.changePassword")}
                  </button>
                  <button type="button" onClick={closePasswordForm} disabled={savingPassword} className="rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-medium text-gray-700 disabled:opacity-60">
                    {t("common.cancel")}
                  </button>
                </div>
                </form>
                )}
                {passwordSuccess && !showPasswordForm && (
                  <p className="text-success-text text-sm">{t("settings.passwordChanged")}</p>
                )}
              </SettingsSection>
            )}

            {/* ── Security & Privacy ────────────────────────────────── */}
            {showSection("security") && (
              <SettingsSection id="security" title={t("settings.securityPrivacy")}>
                {loginEmail && (
                  <FormField label={t("settings.loginEmail")}>
                    <div dir="ltr" className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm text-gray-700">
                      {loginEmail}
                    </div>
                  </FormField>
                )}
                {canManageSettings && (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#111111]">{t("settings.twoFa.title")}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {t("settings.twoFactorHint")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggle2FA}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 ${
                      twoFaEnabled ? "bg-[#F64651]" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        twoFaEnabled ? "-translate-x-1" : "-translate-x-6"
                      }`}
                    />
                  </button>
                </div>
                )}

                {twoFaSuccessMsg && (
                  <div className="p-3 bg-success-bg border border-success-text/20 rounded-xl text-sm text-success-text">
                    {twoFaSuccessMsg}
                  </div>
                )}

                <PermissionGate permission="settings.manage"><button
                  type="button"
                  onClick={() => router.push("/settings/logs")}
                  className="w-full px-5 py-2.5 rounded-md bg-white border border-[#666666] text-[#666666] text-sm font-medium hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA] transition-all text-right"
                >
                  {t("settings.logsLink")}
                </button></PermissionGate>

                <PermissionGate permission="staff.manage"><button
                  type="button"
                  onClick={() => router.push("/settings/permissions")}
                  className="w-full px-5 py-2.5 rounded-md bg-white border border-[#666666] text-[#666666] text-sm font-medium hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA] transition-all text-right"
                >
                  {t("settings.permissionsLink")}
                </button></PermissionGate>

                <PermissionGate permission="settings.storage"><button
                  type="button"
                  onClick={() => router.push("/settings/storage")}
                  className="w-full px-5 py-2.5 rounded-md bg-white border border-[#666666] text-[#666666] text-sm font-medium hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA] transition-all text-right"
                >
                  {t("settings.storageLink")}
                </button></PermissionGate>
              </SettingsSection>
            )}

            {/* ── Trash ──────────────────────────────────────────────── */}
            {showSection("trash") && (() => {
              const currentTrashList = trashTab === "students" ? trashStudents : trashTab === "teachers" ? trashTeachers : trashClasses;
              return (
              <SettingsSection id="trash" title={t("settings.trash")}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex gap-2">
                    {(["students", "teachers", "classes"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => selectTrashTab(tab)}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                          trashTab === tab
                            ? "bg-[#111111] text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {t(`settings.trashTabs.${tab}`)}
                      </button>
                    ))}
                  </div>
                  {currentTrashList.length > 0 && (
                    <button
                      onClick={() => setShowRestoreAllConfirm(true)}
                      className="px-4 py-1.5 border-2 border-[#F64651] text-[#D93A44] rounded-full text-sm font-medium hover:bg-success-bg transition-all"
                    >
                      {t("common.restoreAll")}
                    </button>
                  )}
                </div>

                {restoreAllMsg && (
                  <div className="p-3 bg-success-bg border border-success-text/20 rounded-xl text-sm text-success-text whitespace-pre-line">
                    {restoreAllMsg}
                  </div>
                )}

                {loadingTrash ? (
                  <div className="text-sm text-gray-400 py-6 text-center">{t("common.loading")}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-right py-3 px-2 font-semibold text-gray-600">
                            {trashTab === "students" ? t("settings.trashColumns.studentName") : trashTab === "teachers" ? t("settings.trashColumns.teacherName") : t("settings.trashColumns.className")}
                          </th>
                          <th className="text-right py-3 px-2 font-semibold text-gray-600">{t("settings.trashColumns.deletedAt")}</th>
                          <th className="text-right py-3 px-2 font-semibold text-gray-600">{t("settings.trashColumns.purgesOn")}</th>
                          <th className="text-right py-3 px-2 font-semibold text-gray-600">{t("common.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentTrashList.map((item) => (
                          <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-3 px-2 text-gray-800 font-medium">{item.name}</td>
                            <td className="py-3 px-2 text-gray-500">{formatDMY(item.deletedAt)}</td>
                            <td className="py-3 px-2 text-gray-500">{t("settings.daysCount", { n: String(daysRemaining(item.deletedAt)) })}</td>
                            <td className="py-3 px-2">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleRestore(trashTab, item.id)}
                                  disabled={trashActionId === item.id}
                                  className="px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-60"
                                >
                                  {t("common.restore")}
                                </button>
                                <button
                                  onClick={() => setConfirmPermanentDelete({ type: trashTypeSingular[trashTab], id: item.id })}
                                  disabled={trashActionId === item.id}
                                  className="px-3 py-1.5 text-xs border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-60"
                                >
                                  {t("common.deletePermanently")}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {currentTrashList.length === 0 && (
                          <tr>
                            <td colSpan={4} className="text-center text-gray-400 py-6">{t("common.noData")}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </SettingsSection>
              );
            })()}

            {/* ── Subscription ──────────────────────────────────────── */}
            {showSection("subscription") && (
              <SettingsSection
                id="subscription"
                title={t("settings.subscription.title")}
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200">
                    {planLabel}
                  </span>
                  <button
                    onClick={() => alert(t("settings.planUpdateNote"))}
                    className="px-5 py-2 border-2 border-[#111111] text-[#111111] hover:bg-[#111111] hover:text-white rounded-xl font-medium text-sm transition-all"
                  >
                    {t("settings.subscription.update")}
                  </button>
                </div>
              </SettingsSection>
            )}

            {/* ── Fee Settings ──────────────────────────────────────── */}
            {showSection("fees") && (
              <SettingsSection id="fees" title={t("settings.fees.title")}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <FormField label={t("settings.fees.hourlyLateFee")}>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        value={hourlyLateFee}
                        onChange={(e) =>
                          setHourlyLateFee(parseFloat(e.target.value) || 0)
                        }
                        disabled={!canManageSettings}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                      />
                      <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                        {t("common.sar")}
                      </span>
                    </div>
                  </FormField>
                  <FormField label={t("settings.fees.dailyStudentFee")}>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        value={dailyStudentFee}
                        onChange={(e) =>
                          setDailyStudentFee(parseFloat(e.target.value) || 0)
                        }
                        disabled={!canManageSettings}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                      />
                      <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                        {t("common.sar")}
                      </span>
                    </div>
                  </FormField>
                  <FormField label={t("settings.fees.weeklyStudentFee")}>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        value={weeklyStudentFee}
                        onChange={(e) => setWeeklyStudentFee(e.target.value === "" ? "" : Number(e.target.value))}
                        disabled={!canManageSettings}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                      />
                      <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{t("common.sar")}</span>
                    </div>
                  </FormField>
                  <FormField label={t("settings.fees.monthlyStudentFee")}>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        value={monthlyStudentFee}
                        onChange={(e) =>
                          setMonthlyStudentFee(parseFloat(e.target.value) || 0)
                        }
                        disabled={!canManageSettings}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                      />
                      <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                        {t("common.sar")}
                      </span>
                    </div>
                  </FormField>
                  <FormField label={t("settings.fees.yearlyStudentFee")}>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        value={yearlyStudentFee}
                        onChange={(e) => setYearlyStudentFee(e.target.value === "" ? "" : Number(e.target.value))}
                        disabled={!canManageSettings}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                      />
                      <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{t("common.sar")}</span>
                    </div>
                  </FormField>
                </div>
                {sectionSaveAction("fees")}
              </SettingsSection>
            )}

            {/* ── Academic stages (task 2.44) ───────────────────────── */}
            {showSection("academic-stages") && (
              <SettingsSection id="academic-stages" title={t("settings.stages.title")}>
                <AcademicStagesPanel />
              </SettingsSection>
            )}

            {/* ── Message Template ──────────────────────────────────── */}
            {showSection("message-template") && (
              <SettingsSection
                id="message-template"
                title={t("settings.messageTemplate.title")}
              >
                <FormField label="">
                  <textarea
                    value={reminderTemplate}
                    onChange={(e) => setReminderTemplate(e.target.value)}
                    disabled={!canManageSettings}
                    rows={5}
                    placeholder={t("settings.messageTemplate.placeholder")}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm resize-none"
                  />
                </FormField>
                <div className="mt-3 p-4 bg-gray-50 rounded-xl text-right">
                  <p className="text-sm font-bold text-gray-700 mb-3">{t("variables.title")}:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { key: "child_name", desc: t("variables.childNameDesc") },
                      { key: "guardian_name", desc: t("variables.guardianNameDesc") },
                      { key: "guardian_2_name", desc: t("variables.guardian_2_name") },
                      { key: "school_name", desc: t("variables.schoolNameDesc") },
                      { key: "checkin_time", desc: t("variables.checkinDesc") },
                      { key: "checkout_time", desc: t("variables.checkoutDesc") },
                      { key: "subscription_fee", desc: t("variables.subscription_fee") },
                      { key: "due_date", desc: t("variables.dueDateDesc") },
                      { key: "activity_name", desc: t("variables.activityNameDesc") },
                      { key: "activity_fee", desc: t("variables.activity_fee") },
                      { key: "activity_date", desc: t("variables.activity_date") },
                    ].map(({ key, desc }) => (
                      <div key={key} className="flex items-center gap-2">
                        <code className="text-xs bg-white border border-gray-200 rounded px-2 py-1 text-success-text font-mono">
                          {`<${key}>`}
                        </code>
                        <span className="text-xs text-gray-500">{desc}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-3">
                    {t("settings.variablesHint")}
                  </p>
                </div>
                {sectionSaveAction("notifications")}
              </SettingsSection>
            )}

            {/* ── Notification Log ─────────────────────────────────── */}
            {showSection("notification-log") && (
              <SettingsSection
                id="notification-log"
                title={t("settings.notificationLog.title")}
              >
                {loadingLogs ? (
                  <div className="text-sm text-gray-400">{t("common.loading")}</div>
                ) : logs.length === 0 ? (
                  <div className="text-sm text-gray-400 text-center py-6">{t("common.noData")}</div>
                ) : (
                  <>
                    {/* Bulk delete button */}
                    <div className="flex justify-end mb-2">
                      <button
                        onClick={() => setConfirmBulkDeleteLog(true)}
                        className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-xl hover:bg-red-50 transition-all"
                      >
                        {t("common.clearAll")}
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">{t("settings.notificationLog.recipient")}</th>
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">{t("settings.notificationLog.type")}</th>
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">{t("settings.notificationLog.content")}</th>
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">{t("settings.notificationLog.sentAt")}</th>
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">{t("settings.notificationLog.status")}</th>
                            <th className="py-3 px-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((log) => (
                            <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-3 px-2 text-gray-800 font-medium">{log.recipientName}</td>
                              <td className="py-3 px-2">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.type === "WHATSAPP" ? "bg-gray-100 text-gray-600" : "bg-blue-50 text-blue-700"}`}>
                                  {t(`notificationType.${log.type}`)}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-gray-600 max-w-xs">
                                <span title={log.content}>{log.content.length > 60 ? log.content.slice(0, 60) + "..." : log.content}</span>
                              </td>
                              <td className="py-3 px-2 text-gray-500 whitespace-nowrap">
                                {formatAst(new Date(log.sentAt), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }, locale)}
                              </td>
                              <td className="py-3 px-2"><DeliveryStatusBadge status={log.status} /></td>
                              <td className="py-3 px-2">
                                <button
                                  onClick={() => setConfirmDeleteLogId(log.id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors text-base"
                                  title={t("common.delete")}
                                >
                                  🗑
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {logs.length < logsTotal && (
                      <div className="text-center pt-2">
                        <button
                          onClick={handleLoadMoreLogs}
                          disabled={loadingMoreLogs}
                          className="px-6 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium transition-all disabled:opacity-60"
                        >
                          {loadingMoreLogs ? t("common.loading") : t("settings.showMore", { n: String(logsTotal - logs.length) })}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </SettingsSection>
            )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
