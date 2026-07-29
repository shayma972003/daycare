"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { DeliveryStatusBadge } from "@/components/ui/StatusBadge";
import { t } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface SettingsData {
  settings: {
    hourlyLateFee: number;
    dailyStudentFee: number;
    monthlyStudentFee: number;
    reminderTemplate: string;
  };
  schoolName: string;
  logoUrl: string | null;
  plan: string;
  schoolEmail: string;
  teacherCheckinTime: string;
  teacherCheckoutTime: string;
  studentCheckinTime: string;
  studentCheckoutTime: string;
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
  return (
    <section id={id} className="bg-white rounded-xl shadow-md p-6 space-y-4">
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

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  // Settings state
  const [settingsData, setSettingsData] = useState<SettingsData | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [schoolName, setSchoolName] = useState("");
  const [email, setEmail] = useState("");
  const [hourlyLateFee, setHourlyLateFee] = useState(0);
  const [dailyStudentFee, setDailyStudentFee] = useState(0);
  const [monthlyStudentFee, setMonthlyStudentFee] = useState(0);
  const [reminderTemplate, setReminderTemplate] = useState("");

  // School hours state
  const [teacherCheckinTime, setTeacherCheckinTime] = useState("");
  const [teacherCheckoutTime, setTeacherCheckoutTime] = useState("");
  const [studentCheckinTime, setStudentCheckinTime] = useState("");
  const [studentCheckoutTime, setStudentCheckoutTime] = useState("");

  // Legal info state
  const [commercialRegistration, setCommercialRegistration] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [address, setAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  // 2FA / security state
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [phoneWarning, setPhoneWarning] = useState("");
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

  // Fetch settings
  useEffect(() => {
    setLoadingSettings(true);
    axios
      .get<SettingsData>("/api/settings")
      .then((res) => {
        const d = res.data;
        setSettingsData(d);
        setSchoolName(d.schoolName);
        setLogoUrl(d.logoUrl ?? null);
        setEmail(d.schoolEmail);
        setHourlyLateFee(d.settings.hourlyLateFee);
        setDailyStudentFee(d.settings.dailyStudentFee);
        setMonthlyStudentFee(d.settings.monthlyStudentFee);
        setReminderTemplate(d.settings.reminderTemplate);
        setTeacherCheckinTime(d.teacherCheckinTime ?? "");
        setTeacherCheckoutTime(d.teacherCheckoutTime ?? "");
        setStudentCheckinTime(d.studentCheckinTime ?? "");
        setStudentCheckoutTime(d.studentCheckoutTime ?? "");
        setCommercialRegistration(d.commercialRegistration ?? "");
        setVatNumber(d.vatNumber ?? "");
        setContactNumber(d.contactNumber ?? "");
        setAddress(d.address ?? "");
        setPhoneNumber(d.phoneNumber ?? "");
        setTwoFaEnabled(d.twoFaEnabled ?? false);
        setSettingsError("");
      })
      .catch(() => setSettingsError("فشل تحميل الإعدادات"))
      .finally(() => setLoadingSettings(false));
  }, []);

  // Fetch initial notification logs (reminders + other, exclude activity logs)
  useEffect(() => {
    setLoadingLogs(true);
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

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      await axios.put("/api/settings", {
        schoolName,
        email,
        hourlyLateFee,
        dailyStudentFee,
        monthlyStudentFee,
        reminderTemplate,
        teacherCheckinTime,
        teacherCheckoutTime,
        studentCheckinTime,
        studentCheckoutTime,
        commercialRegistration,
        vatNumber,
        contactNumber,
        address,
        phoneNumber,
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch {
      alert("فشل حفظ الإعدادات");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleChangePassword() {
    setPasswordError("");
    setPasswordSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("يرجى ملء جميع الحقول");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("كلمة المرور الجديدة وتأكيدها غير متطابقتين");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل");
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
    } catch (err: unknown) {
      if (
        axios.isAxiosError(err) &&
        err.response?.data?.error === "Current password is incorrect"
      ) {
        setPasswordError("كلمة المرور الحالية غير صحيحة");
      } else {
        setPasswordError("فشل تغيير كلمة المرور");
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
    if (!phoneNumber) {
      setPhoneWarning("يجب إضافة رقم الجوال في معلومات المنشأة أولاً قبل تفعيل التحقق بخطوتين");
      return;
    }
    setPhoneWarning("");
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
      setActivateError("تعذر إرسال رمز التحقق");
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
      setTwoFaSuccessMsg("تم تفعيل التحقق بخطوتين ✓");
      setTimeout(() => setTwoFaSuccessMsg(""), 4000);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setActivateError(err.response.data.error);
      } else {
        setActivateError("رمز التحقق غير صحيح");
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
        setDeactivateError("حدث خطأ، الرجاء المحاولة مرة أخرى");
      }
    } finally {
      setDeactivateLoading(false);
    }
  }

  // ── Trash handlers ────────────────────────────────────────────────────────

  async function loadTrash(tab: "students" | "teachers" | "classes") {
    setLoadingTrash(true);
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
    loadTrash(trashTab);
    setRestoreAllMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashTab]);

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
      alert("فشل الاستعادة");
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
        let msg = `تم استعادة ${res.data.restored} طالب`;
        if (res.data.needsReassignment > 0) {
          msg += `\nيحتاج ${res.data.needsReassignment} طالب إلى تعيين فصل`;
        }
        setRestoreAllMsg(msg);
      } else if (trashTab === "teachers") {
        const res = await axios.post<{ restored: number }>("/api/trash/restore-all/teachers");
        setRestoreAllMsg(`تم استعادة ${res.data.restored} معلم`);
      } else {
        const res = await axios.post<{ restored: number }>("/api/trash/restore-all/classes");
        setRestoreAllMsg(`تم استعادة ${res.data.restored} فصل`);
      }
      await loadTrash(trashTab);
    } catch {
      alert("فشل الاستعادة");
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
      alert("فشل الحذف النهائي");
    } finally {
      setTrashActionId(null);
      setConfirmPermanentDelete(null);
    }
  }

  function daysRemaining(deletedAt: string) {
    return Math.ceil(
      (new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
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
      alert("فشل رفع الشعار");
    } finally {
      setLogoUploading(false);
      e.target.value = "";
    }
  }

  // ── Search filter ─────────────────────────────────────────────────────────

  const sections = useMemo(
    () => [
      { id: "school-info", title: "معلومات المنشأة" },
      { id: "school-hours", title: "ساعات الدوام" },
      { id: "password", title: t("settings.changePassword") },
      { id: "security", title: "الأمان والخصوصية" },
      { id: "trash", title: "سلة المحذوفات" },
      { id: "subscription", title: t("settings.subscription.title") },
      { id: "fees", title: t("settings.fees.title") },
      { id: "message-template", title: t("settings.messageTemplate.title") },
      { id: "notification-log", title: t("settings.notificationLog.title") },
    ],
    []
  );

  const filteredSections = useMemo(() => {
    if (!search.trim()) return sections.map((s) => s.id);
    const q = search.toLowerCase();
    return sections
      .filter((s) => s.title.toLowerCase().includes(q))
      .map((s) => s.id);
  }, [search, sections]);

  function showSection(id: string) {
    return filteredSections.includes(id);
  }

  // ── Plan label ────────────────────────────────────────────────────────────

  const planLabels: Record<string, string> = {
    basic: "أساسية",
    pro: "احترافية",
    enterprise: "مؤسسية",
  };
  const planLabel = planLabels[settingsData?.plan ?? ""] ?? settingsData?.plan ?? "—";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50">
      <Topbar title={t("settings.title")} />

      {/* Confirm delete one log */}
      {confirmDeleteLogId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">هل تريد حذف هذا السجل؟</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => handleDeleteOneLog(confirmDeleteLogId)} disabled={!!deletingLogId} className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60">{deletingLogId ? "..." : "حذف"}</button>
              <button onClick={() => setConfirmDeleteLogId(null)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Activate 2FA modal */}
      {showActivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 space-y-4">
            <h3 className="text-base font-bold text-[#111111] text-center">تفعيل التحقق بخطوتين</h3>

            {activateStep === "confirm" ? (
              <>
                <p className="text-sm text-gray-600 text-center" dir="ltr">
                  سيتم إرسال رمز تحقق إلى: +966{phoneNumber}
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
                    {activateLoading ? "..." : "إرسال رمز التحقق"}
                  </button>
                  <button
                    onClick={() => setShowActivateModal(false)}
                    className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                  >
                    إلغاء
                  </button>
                </div>
              </>
            ) : (
              <>
                <FormField label="رمز التحقق">
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
                    {activateLoading ? "..." : "تأكيد"}
                  </button>
                  <button
                    onClick={() => setShowActivateModal(false)}
                    className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                  >
                    إلغاء
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
            <h3 className="text-base font-bold text-[#111111] text-center">إيقاف التحقق بخطوتين</h3>
            <FormField label="كلمة المرور الحالية">
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
                {deactivateLoading ? "..." : "إيقاف التحقق"}
              </button>
              <button
                onClick={() => setShowDeactivateModal(false)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                إلغاء
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
              هل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handlePermanentDelete}
                disabled={!!trashActionId}
                className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
              >
                {trashActionId ? "..." : "حذف نهائي"}
              </button>
              <button
                onClick={() => setConfirmPermanentDelete(null)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                إلغاء
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
                ? `هل تريد استعادة جميع الطلاب المحذوفين؟ (${trashStudents.length} طلاب)`
                : trashTab === "teachers"
                ? `هل تريد استعادة جميع المعلمين المحذوفين؟ (${trashTeachers.length} معلمين)`
                : `هل تريد استعادة جميع الفصول المحذوفة؟ (${trashClasses.length} فصول)`}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleRestoreAll}
                disabled={restoringAll}
                className="px-5 py-2 bg-[#F64651] text-white rounded-xl text-sm font-medium hover:bg-[#D93A44] disabled:opacity-60"
              >
                {restoringAll ? "..." : "استعادة الكل"}
              </button>
              <button
                onClick={() => setShowRestoreAllConfirm(false)}
                className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm bulk delete logs */}
      {confirmBulkDeleteLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
            <p className="text-sm font-medium text-[#111111]">هل تريد حذف جميع سجلات الإشعارات؟ لا يمكن التراجع عن هذا الإجراء</p>
            <div className="flex gap-3 justify-center">
              <button onClick={handleDeleteBulkLog} disabled={deletingBulkLog} className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60">{deletingBulkLog ? "..." : "مسح الكل"}</button>
              <button onClick={() => setConfirmBulkDeleteLog(false)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Search */}
        <div className="relative">
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            🔍
          </span>
          <input
            type="text"
            placeholder={t("settings.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pr-9 pl-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm bg-white"
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
            {/* ── School Info (merged with Legal Info) ──────────────── */}
            {showSection("school-info") && (
              <SettingsSection id="school-info" title="معلومات المنشأة">
                {/* Logo */}
                <FormField label={t("settings.logo")}>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-gray-100 border border-gray-200 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
                      {logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logoUrl} alt="شعار المنشأة" className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-2xl">🏫</span>
                      )}
                    </div>
                    <div>
                      <label className={`cursor-pointer px-4 py-2 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-all inline-block ${logoUploading ? "opacity-50 pointer-events-none" : ""}`}>
                        {logoUploading ? "جارٍ الرفع…" : t("common.upload")}
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept=".png,.svg,image/png,image/svg+xml"
                          className="hidden"
                          onChange={handleLogoUpload}
                        />
                      </label>
                      <p className="text-xs text-gray-400 mt-1.5">الحجم الموصى به للصور هو 400×400 px</p>
                    </div>
                  </div>
                </FormField>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label={t("settings.schoolName")}>
                    <input
                      type="text"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    />
                  </FormField>
                  <FormField label={t("settings.email")}>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      dir="ltr"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    />
                  </FormField>
                  <FormField label="رقم السجل التجاري">
                    <input
                      type="text"
                      value={commercialRegistration}
                      onChange={(e) => setCommercialRegistration(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    />
                  </FormField>
                  <FormField label="الرقم الضريبي VAT">
                    <input
                      type="text"
                      value={vatNumber}
                      onChange={(e) => setVatNumber(e.target.value)}
                      dir="ltr"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    />
                  </FormField>
                  <FormField label="رقم التواصل">
                    <input
                      type="text"
                      value={contactNumber}
                      onChange={(e) => setContactNumber(e.target.value)}
                      dir="ltr"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    />
                  </FormField>
                  <FormField label="العنوان">
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    />
                  </FormField>
                  <FormField label="رقم الجوال">
                    <input
                      type="text"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      dir="ltr"
                      placeholder="5XXXXXXXX"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    />
                  </FormField>
                </div>
              </SettingsSection>
            )}

            {/* ── School Hours ──────────────────────────────────────── */}
            {showSection("school-hours") && (
              <SettingsSection id="school-hours" title="ساعات الدوام">
                <div className="space-y-4">
                  <p className="text-xs text-gray-500">تُستخدم هذه الأوقات لحساب ساعات التأخير تلقائياً</p>
                  <div>
                    <h3 className="text-sm font-semibold text-[#111111] mb-3">المعلمون</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField label="وقت الدخول">
                        <input
                          type="time"
                          value={teacherCheckinTime}
                          onChange={(e) => setTeacherCheckinTime(e.target.value)}
                          dir="ltr"
                          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                        />
                      </FormField>
                      <FormField label="وقت الخروج">
                        <input
                          type="time"
                          value={teacherCheckoutTime}
                          onChange={(e) => setTeacherCheckoutTime(e.target.value)}
                          dir="ltr"
                          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                        />
                      </FormField>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#111111] mb-3">الطلاب</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField label="وقت الدخول">
                        <input
                          type="time"
                          value={studentCheckinTime}
                          onChange={(e) => setStudentCheckinTime(e.target.value)}
                          dir="ltr"
                          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                        />
                      </FormField>
                      <FormField label="وقت الخروج">
                        <input
                          type="time"
                          value={studentCheckoutTime}
                          onChange={(e) => setStudentCheckoutTime(e.target.value)}
                          dir="ltr"
                          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                        />
                      </FormField>
                    </div>
                  </div>
                </div>
              </SettingsSection>
            )}

            {/* ── Change Password ────────────────────────────────────── */}
            {showSection("password") && (
              <SettingsSection
                id="password"
                title={t("settings.changePassword")}
              >
                <FormField label={t("settings.currentPassword")}>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
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
                    dir="ltr"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    placeholder="••••••••"
                  />
                </FormField>
                <FormField label={t("settings.confirmPassword")}>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    dir="ltr"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                    placeholder="••••••••"
                  />
                </FormField>

                {passwordError && (
                  <p className="text-red-600 text-sm">{passwordError}</p>
                )}
                {passwordSuccess && (
                  <p className="text-success-text text-sm">
                    تم تغيير كلمة المرور بنجاح
                  </p>
                )}

                <button
                  onClick={handleChangePassword}
                  disabled={savingPassword}
                  className="px-6 py-2.5 bg-[#111111] hover:bg-[#253055] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {savingPassword ? t("common.loading") : "تغيير كلمة المرور"}
                </button>
              </SettingsSection>
            )}

            {/* ── Security & Privacy ────────────────────────────────── */}
            {showSection("security") && (
              <SettingsSection id="security" title="الأمان والخصوصية">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#111111]">التحقق بخطوتين</p>
                    <p className="text-xs text-gray-500 mt-1">
                      حماية حسابك بطبقة أمان إضافية عبر رمز يُرسل إلى جوالك عند كل تسجيل دخول
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

                {phoneWarning && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                    {phoneWarning}
                  </div>
                )}
                {twoFaSuccessMsg && (
                  <div className="p-3 bg-success-bg border border-success-text/20 rounded-xl text-sm text-success-text">
                    {twoFaSuccessMsg}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => router.push("/settings/logs")}
                  className="w-full px-5 py-2.5 rounded-md bg-white border border-[#666666] text-[#666666] text-sm font-medium hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA] transition-all text-right"
                >
                  عرض سجل التغييرات ←
                </button>
              </SettingsSection>
            )}

            {/* ── Trash ──────────────────────────────────────────────── */}
            {showSection("trash") && (() => {
              const currentTrashList = trashTab === "students" ? trashStudents : trashTab === "teachers" ? trashTeachers : trashClasses;
              return (
              <SettingsSection id="trash" title="سلة المحذوفات">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex gap-2">
                    {(["students", "teachers", "classes"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setTrashTab(tab)}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                          trashTab === tab
                            ? "bg-[#111111] text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {tab === "students" ? "طلاب" : tab === "teachers" ? "معلمون" : "فصول"}
                      </button>
                    ))}
                  </div>
                  {currentTrashList.length > 0 && (
                    <button
                      onClick={() => setShowRestoreAllConfirm(true)}
                      className="px-4 py-1.5 border-2 border-[#F64651] text-[#D93A44] rounded-full text-sm font-medium hover:bg-success-bg transition-all"
                    >
                      استعادة الكل
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
                            {trashTab === "students" ? "اسم الطالب" : trashTab === "teachers" ? "اسم المعلم" : "اسم الفصل"}
                          </th>
                          <th className="text-right py-3 px-2 font-semibold text-gray-600">تاريخ الحذف</th>
                          <th className="text-right py-3 px-2 font-semibold text-gray-600">يُحذف نهائياً في</th>
                          <th className="text-right py-3 px-2 font-semibold text-gray-600">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentTrashList.map((item) => (
                          <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-3 px-2 text-gray-800 font-medium">{item.name}</td>
                            <td className="py-3 px-2 text-gray-500">{formatDMY(item.deletedAt)}</td>
                            <td className="py-3 px-2 text-gray-500">{daysRemaining(item.deletedAt)} يوم</td>
                            <td className="py-3 px-2">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleRestore(trashTab, item.id)}
                                  disabled={trashActionId === item.id}
                                  className="px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-60"
                                >
                                  استعادة
                                </button>
                                <button
                                  onClick={() => setConfirmPermanentDelete({ type: trashTypeSingular[trashTab], id: item.id })}
                                  disabled={trashActionId === item.id}
                                  className="px-3 py-1.5 text-xs border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-60"
                                >
                                  حذف نهائي
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
                    onClick={() => alert("سيتم التواصل معكم لتحديث الخطة")}
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <FormField label={t("settings.fees.hourlyLateFee")}>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        value={hourlyLateFee}
                        onChange={(e) =>
                          setHourlyLateFee(parseFloat(e.target.value) || 0)
                        }
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
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
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                        {t("common.sar")}
                      </span>
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
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm"
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                        {t("common.sar")}
                      </span>
                    </div>
                  </FormField>
                </div>
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
                    rows={5}
                    placeholder={t("settings.messageTemplate.placeholder")}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#111111] text-sm resize-none"
                  />
                </FormField>
                <div className="mt-3 p-4 bg-gray-50 rounded-xl text-right">
                  <p className="text-sm font-bold text-gray-700 mb-3">المتغيرات المتاحة:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { key: "child_name", desc: "اسم الطفل" },
                      { key: "guardian_name", desc: "اسم ولي الأمر الأول" },
                      { key: "guardian_2_name", desc: "اسم ولي الأمر الثاني" },
                      { key: "school_name", desc: "اسم المنشأة" },
                      { key: "checkin_time", desc: "وقت الدخول من الإعدادات" },
                      { key: "checkout_time", desc: "وقت الخروج من الإعدادات" },
                      { key: "subscription_fee", desc: "رسوم التسجيل من ملف الطالب" },
                      { key: "due_date", desc: "تاريخ انتهاء الاشتراك" },
                      { key: "activity_name", desc: "اسم الفعالية" },
                      { key: "activity_fee", desc: "رسوم الفعالية" },
                      { key: "activity_date", desc: "من (تاريخ البدء) إلى (تاريخ الانتهاء)" },
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
                    اكتب المتغير في نص الرسالة وسيتم استبداله تلقائياً بالقيمة الفعلية عند الإرسال.
                  </p>
                </div>
              </SettingsSection>
            )}

            {/* ── Save Settings Button ─────────────────────────────── */}
            {filteredSections.some((id) =>
              ["school-info", "school-hours", "fees", "message-template"].includes(id)
            ) && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="px-8 py-3 bg-[#F64651] hover:bg-[#D93A44] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
                >
                  {savingSettings ? t("common.loading") : t("settings.save")}
                </button>
                {settingsSaved && (
                  <span className="text-success-text text-sm font-medium">
                    {t("common.success")}
                  </span>
                )}
              </div>
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
                        مسح الكل
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
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.type === "WHATSAPP" ? "bg-success-bg text-success-text" : "bg-blue-50 text-blue-700"}`}>
                                  {t(`notificationType.${log.type}`)}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-gray-600 max-w-xs">
                                <span title={log.content}>{log.content.length > 60 ? log.content.slice(0, 60) + "..." : log.content}</span>
                              </td>
                              <td className="py-3 px-2 text-gray-500 whitespace-nowrap">
                                {new Date(log.sentAt).toLocaleDateString("ar-SA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </td>
                              <td className="py-3 px-2"><DeliveryStatusBadge status={log.status} /></td>
                              <td className="py-3 px-2">
                                <button
                                  onClick={() => setConfirmDeleteLogId(log.id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors text-base"
                                  title="حذف"
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
                          {loadingMoreLogs ? t("common.loading") : `عرض المزيد (${logsTotal - logs.length} متبقي)`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </SettingsSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}
