"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { VariableReference } from "@/components/ui/VariableReference";
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
      <h2 className="text-base font-bold text-[#1a2340] border-b border-gray-100 pb-3">
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
            className="w-full pr-9 pl-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm bg-white"
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
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                    />
                  </FormField>
                  <FormField label={t("settings.email")}>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      dir="ltr"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                    />
                  </FormField>
                  <FormField label="رقم السجل التجاري">
                    <input
                      type="text"
                      value={commercialRegistration}
                      onChange={(e) => setCommercialRegistration(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                    />
                  </FormField>
                  <FormField label="الرقم الضريبي VAT">
                    <input
                      type="text"
                      value={vatNumber}
                      onChange={(e) => setVatNumber(e.target.value)}
                      dir="ltr"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                    />
                  </FormField>
                  <FormField label="رقم التواصل">
                    <input
                      type="text"
                      value={contactNumber}
                      onChange={(e) => setContactNumber(e.target.value)}
                      dir="ltr"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                    />
                  </FormField>
                  <FormField label="العنوان">
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
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
                    <h3 className="text-sm font-semibold text-[#1a2340] mb-3">المعلمون</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField label="وقت الدخول">
                        <input
                          type="time"
                          value={teacherCheckinTime}
                          onChange={(e) => setTeacherCheckinTime(e.target.value)}
                          dir="ltr"
                          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                        />
                      </FormField>
                      <FormField label="وقت الخروج">
                        <input
                          type="time"
                          value={teacherCheckoutTime}
                          onChange={(e) => setTeacherCheckoutTime(e.target.value)}
                          dir="ltr"
                          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                        />
                      </FormField>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#1a2340] mb-3">الطلاب</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField label="وقت الدخول">
                        <input
                          type="time"
                          value={studentCheckinTime}
                          onChange={(e) => setStudentCheckinTime(e.target.value)}
                          dir="ltr"
                          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                        />
                      </FormField>
                      <FormField label="وقت الخروج">
                        <input
                          type="time"
                          value={studentCheckoutTime}
                          onChange={(e) => setStudentCheckoutTime(e.target.value)}
                          dir="ltr"
                          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                    placeholder="••••••••"
                  />
                </FormField>
                <FormField label={t("settings.newPassword")}>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    dir="ltr"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                    placeholder="••••••••"
                  />
                </FormField>
                <FormField label={t("settings.confirmPassword")}>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    dir="ltr"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
                    placeholder="••••••••"
                  />
                </FormField>

                {passwordError && (
                  <p className="text-red-600 text-sm">{passwordError}</p>
                )}
                {passwordSuccess && (
                  <p className="text-green-600 text-sm">
                    تم تغيير كلمة المرور بنجاح
                  </p>
                )}

                <button
                  onClick={handleChangePassword}
                  disabled={savingPassword}
                  className="px-6 py-2.5 bg-[#1a2340] hover:bg-[#253055] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {savingPassword ? t("common.loading") : "تغيير كلمة المرور"}
                </button>
              </SettingsSection>
            )}

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
                    className="px-5 py-2 border-2 border-[#1a2340] text-[#1a2340] hover:bg-[#1a2340] hover:text-white rounded-xl font-medium text-sm transition-all"
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
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
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
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
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
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm"
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
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm resize-none"
                  />
                </FormField>
                <VariableReference mode="payment" />
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
                  className="px-8 py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
                >
                  {savingSettings ? t("common.loading") : t("settings.save")}
                </button>
                {settingsSaved && (
                  <span className="text-green-600 text-sm font-medium">
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
                  <div className="text-sm text-gray-400">
                    {t("common.loading")}
                  </div>
                ) : logs.length === 0 ? (
                  <div className="text-sm text-gray-400 text-center py-6">
                    {t("common.noData")}
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">
                              {t("settings.notificationLog.recipient")}
                            </th>
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">
                              {t("settings.notificationLog.type")}
                            </th>
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">
                              {t("settings.notificationLog.content")}
                            </th>
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">
                              {t("settings.notificationLog.sentAt")}
                            </th>
                            <th className="text-right py-3 px-2 font-semibold text-gray-600">
                              {t("settings.notificationLog.status")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((log) => (
                            <tr
                              key={log.id}
                              className="border-b border-gray-50 hover:bg-gray-50"
                            >
                              <td className="py-3 px-2 text-gray-800 font-medium">
                                {log.recipientName}
                              </td>
                              <td className="py-3 px-2">
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    log.type === "WHATSAPP"
                                      ? "bg-green-50 text-green-700"
                                      : "bg-blue-50 text-blue-700"
                                  }`}
                                >
                                  {t(`notificationType.${log.type}`)}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-gray-600 max-w-xs">
                                <span title={log.content}>
                                  {log.content.length > 60
                                    ? log.content.slice(0, 60) + "..."
                                    : log.content}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-gray-500 whitespace-nowrap">
                                {new Date(log.sentAt).toLocaleDateString(
                                  "ar-SA",
                                  {
                                    year: "numeric",
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </td>
                              <td className="py-3 px-2">
                                <DeliveryStatusBadge status={log.status} />
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
                          {loadingMoreLogs
                            ? t("common.loading")
                            : `عرض المزيد (${logsTotal - logs.length} متبقي)`}
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
