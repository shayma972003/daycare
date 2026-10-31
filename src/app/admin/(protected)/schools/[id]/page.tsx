"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import * as Tabs from "@radix-ui/react-tabs";
import { AdminInvoiceModal } from "@/components/admin/AdminInvoiceModal";

interface SchoolDetail {
  school: {
    id: string;
    name: string;
    email: string | null;
    plan_id: string | null;
    plan: { id: string; name: string; price: number; billing_interval: "MONTHLY" | "YEARLY" | null } | null;
    subscription_type: SubscriptionType | "UNASSIGNED";
    subscription_status: string;
    access_mode: "active" | "grace" | "locked";
    renewal_date: string | null;
    suspended_at: string | null;
    suspension_reason: string | null;
    last_login_at: string | null;
    createdAt: string;
    updatedAt: string;
    contactNumber: string | null;
    phoneNumber: string | null;
    legalName: string | null;
    commercialRegistration: string | null;
    nationalUnifiedNumber: string | null;
    entityType: string | null;
    businessActivities: string | null;
    schoolType: string | null;
    educationStages: string[];
    licenseNumber: string | null;
    branch: string | null;
    address: string | null;
    vatRegistered: boolean | null;
    vatNumber: string | null;
    zatcaUnifiedNumber: string | null;
    zakatStatus: string | null;
    financialYear: string | null;
    taxPeriod: string | null;
  };
  stats: { students: number; teachers: number; classes: number; invoices: number; notifications: number };
  support: {
    accounts: {
      staff: AccountSummary;
      guardians: AccountSummary;
      latestGuardianLoginAt: string | null;
    };
    devices: {
      total: number;
      healthy: number;
      failed: number;
      expo: number;
      web: number;
      lastSeenAt: string | null;
      items: {
        id: string;
        ownerKind: "staff" | "guardian";
        ownerName: string;
        ownerEmail: string | null;
        platform: "EXPO" | "WEB" | "HUAWEI";
        status: "healthy" | "failed";
        lastSeenAt: string;
        registeredAt: string;
        canTest: boolean;
      }[];
    };
    notifications: {
      windowDays: number;
      push: {
        pending: number;
        sent: number;
        failed: number;
        latestFailureAt: string | null;
        latestFailure: string | null;
        recentFailures: {
          id: string;
          deviceId: string | null;
          occurredAt: string;
          reason: string | null;
        }[];
      };
      outbound: {
        sent: number;
        failed: number;
        recent: {
          id: string;
          type: "EMAIL" | "WHATSAPP";
          status: "SENT" | "FAILED";
          source: string;
          sentAt: string;
        }[];
      };
    };
    storage: {
      totalBytes: number;
      maxBytes: number | null;
      computedAt: string | null;
      breakdown: {
        studentFilesBytes: number;
        careReportBytes: number;
        staffFilesBytes: number;
        unitFilesBytes: number;
        invoiceBytes: number;
        otherBytes: number;
      };
    };
    configuration: {
      careReportReviewRequired: boolean;
      arrivalRecipientCount: number;
      pendingCareReportCount: number;
    };
  };
  activityLogs: { id: string; action: string; metadata: unknown; performed_by: string; performed_at: string }[];
  messages: { id: string; subject: string; sent_at: string | null; is_automated: boolean; delivered_at: string | null; read_at: string | null }[];
}

interface AccountSummary {
  total: number;
  active: number;
  pending: number;
  expiredInvitations: number;
  disabled: number;
}

type SubscriptionType = "TRIAL" | "MONTHLY" | "YEARLY";

interface AdminInvoice {
  id: string;
  invoice_number: string;
  subscription_type: string | null;
  issue_date: string;
  total_amount: number;
  status: string;
  file_url: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  active: "نشط", suspended: "موقوف", expired: "منتهٍ", trial: "تجريبي",
};
const SUBSCRIPTION_TYPE_LABELS: Record<SubscriptionType | "UNASSIGNED", string> = {
  TRIAL: "تجريبي — شهر واحد",
  MONTHLY: "شهري — 299 ر.س",
  YEARLY: "سنوي — 2990 ر.س",
  UNASSIGNED: "غير محدد",
};

const EDUCATION_STAGE_OPTIONS = ["حضانة", "تمهيدي", "رياض أطفال", "ابتدائي"];
const ENTITY_TYPE_OPTIONS = ["مؤسسة فردية", "شركة ذات مسؤولية محدودة", "شركة مساهمة", "شركة تضامن", "أخرى"];
const SCHOOL_TYPE_OPTIONS = ["حضانة", "روضة أطفال", "مركز رعاية نهارية", "أخرى"];
const ZAKAT_STATUS_LABELS: Record<string, string> = { yes: "نعم", no: "لا", needs_review: "يحتاج مراجعة" };

function supportDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ar-SA") : "لا يوجد";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} م.ب`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ج.ب`;
}

export default function SchoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<SchoolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionType, setSubscriptionType] = useState<SubscriptionType>("TRIAL");
  const [subscriptionSaving, setSubscriptionSaving] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);

  // Edit form state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editContactNumber, setEditContactNumber] = useState("");
  const [editPhoneNumber, setEditPhoneNumber] = useState("");
  const [editLegalName, setEditLegalName] = useState("");
  const [editCommercialRegistration, setEditCommercialRegistration] = useState("");
  const [editNationalUnifiedNumber, setEditNationalUnifiedNumber] = useState("");
  const [editEntityType, setEditEntityType] = useState("");
  const [editBusinessActivities, setEditBusinessActivities] = useState("");
  const [editSchoolType, setEditSchoolType] = useState("");
  const [editEducationStages, setEditEducationStages] = useState<string[]>([]);
  const [editLicenseNumber, setEditLicenseNumber] = useState("");
  const [editBranch, setEditBranch] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editVatRegistered, setEditVatRegistered] = useState<"" | "yes" | "no">("");
  const [editVatNumber, setEditVatNumber] = useState("");
  const [editZatcaUnifiedNumber, setEditZatcaUnifiedNumber] = useState("");
  const [editZakatStatus, setEditZakatStatus] = useState<"" | "yes" | "no" | "needs_review">("");
  const [editFinancialYear, setEditFinancialYear] = useState("");
  const [editTaxPeriod, setEditTaxPeriod] = useState("");

  function toggleEditStage(stage: string) {
    setEditEducationStages((prev) => (prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]));
  }

  // Suspend dialog
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [testingDeviceId, setTestingDeviceId] = useState<string | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);

  // Admin invoices
  const [invoices, setInvoices] = useState<AdminInvoice[]>([]);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

  function loadInvoices() {
    axios
      .get<AdminInvoice[]>(`/api/admin/invoices/${id}`)
      .then((res) => setInvoices(res.data))
      .catch(() => setInvoices([]));
  }

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function viewInvoicePdf(fileUrl: string) {
    const base64 = fileUrl.split(",")[1];
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    window.open(url, "_blank");
  }

  function downloadInvoicePdf(fileUrl: string, name: string) {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = `${name}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const applySchoolResponse = useCallback((schoolData: SchoolDetail) => {
      setData(schoolData);
      const s = schoolData.school;
      setEditName(s.name);
      setEditEmail(s.email ?? "");
      setSubscriptionType(s.subscription_type === "UNASSIGNED" ? "TRIAL" : s.subscription_type);
      setEditContactNumber(s.contactNumber ?? "");
      setEditPhoneNumber(s.phoneNumber ?? "");
      setEditLegalName(s.legalName ?? "");
      setEditCommercialRegistration(s.commercialRegistration ?? "");
      setEditNationalUnifiedNumber(s.nationalUnifiedNumber ?? "");
      setEditEntityType(s.entityType ?? "");
      setEditBusinessActivities(s.businessActivities ?? "");
      setEditSchoolType(s.schoolType ?? "");
      setEditEducationStages(s.educationStages ?? []);
      setEditLicenseNumber(s.licenseNumber ?? "");
      setEditBranch(s.branch ?? "");
      setEditAddress(s.address ?? "");
      setEditVatRegistered(s.vatRegistered === true ? "yes" : s.vatRegistered === false ? "no" : "");
      setEditVatNumber(s.vatNumber ?? "");
      setEditZatcaUnifiedNumber(s.zatcaUnifiedNumber ?? "");
      setEditZakatStatus((s.zakatStatus as "" | "yes" | "no" | "needs_review") ?? "");
      setEditFinancialYear(s.financialYear ?? "");
      setEditTaxPeriod(s.taxPeriod ?? "");
  }, []);

  async function retryLoadSchool() {
    setLoading(true);
    setActionError(null);
    try {
      const schoolRes = await axios.get<SchoolDetail>(`/api/admin/schools/${id}`);
      applySchoolResponse(schoolRes.data);
    } catch (err) {
      setData(null);
      setActionError(describeApiError(err, "فشل تحميل بيانات المدرسة"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    axios.get<SchoolDetail>(`/api/admin/schools/${id}`)
      .then((schoolRes) => {
        if (active) applySchoolResponse(schoolRes.data);
      })
      .catch((err) => {
        if (active) setActionError(describeApiError(err, "فشل تحميل بيانات المدرسة"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applySchoolResponse, id]);

  async function handleSave() {
    if (identitySaving || !data) return;
    setIdentitySaving(true);
    setActionError(null);
    try {
      await axios.put(`/api/admin/schools/${id}`, {
        expectedUpdatedAt: data.school.updatedAt,
        name: editName,
        email: editEmail || null,
        contactNumber: editContactNumber || null,
        phoneNumber: editPhoneNumber || null,
        legalName: editLegalName || null,
        commercialRegistration: editCommercialRegistration || null,
        nationalUnifiedNumber: editNationalUnifiedNumber || null,
        entityType: editEntityType || null,
        businessActivities: editBusinessActivities || null,
        schoolType: editSchoolType || null,
        educationStages: editEducationStages,
        licenseNumber: editLicenseNumber || null,
        branch: editBranch || null,
        address: editAddress || null,
        vatRegistered: editVatRegistered ? editVatRegistered === "yes" : null,
        vatNumber: editVatNumber || null,
        zatcaUnifiedNumber: editZatcaUnifiedNumber || null,
        zakatStatus: editZakatStatus || null,
        financialYear: editFinancialYear || null,
        taxPeriod: editTaxPeriod || null,
      });
      const res = await axios.get<SchoolDetail>(`/api/admin/schools/${id}`);
      setData(res.data);
      setEditing(false);
    } catch (error) {
      setActionError(describeApiError(error, "تعذر حفظ بيانات المدرسة"));
    } finally {
      setIdentitySaving(false);
    }
  }

  async function handleChangeSubscriptionType() {
    setSubscriptionSaving(true);
    try {
      await axios.put(`/api/admin/subscriptions/${id}`, {
        action: "change_type",
        subscription_type: subscriptionType,
      });
      const res = await axios.get<SchoolDetail>(`/api/admin/schools/${id}`);
      setData(res.data);
      const nextType = res.data.school.subscription_type;
      setSubscriptionType(nextType === "UNASSIGNED" ? "TRIAL" : nextType);
    } finally {
      setSubscriptionSaving(false);
    }
  }

  async function handleSuspend() {
    await axios.post(`/api/admin/schools/${id}/suspend`, { reason: suspendReason });
    const res = await axios.get<SchoolDetail>(`/api/admin/schools/${id}`);
    setData(res.data);
    setSuspendOpen(false);
    setSuspendReason("");
  }

  async function handleReactivate() {
    await axios.post(`/api/admin/schools/${id}/reactivate`);
    const res = await axios.get<SchoolDetail>(`/api/admin/schools/${id}`);
    setData(res.data);
  }

  async function handleDelete() {
    if (deleteConfirm !== data?.school.name) return;
    await axios.delete(`/api/admin/schools/${id}`);
    router.push("/admin/schools");
  }

  /**
   * All four handlers above awaited with no catch. Deleting a school in
   * particular fails outright when the tenant has related rows, and the dialog
   * simply sat there as though nothing had been clicked.
   */
  function guard(action: () => Promise<void>, fallback: string) {
    return async () => {
      setActionError(null);
      try {
        await action();
      } catch (err) {
        setActionError(describeApiError(err, fallback));
      }
    };
  }

  const onSave = guard(handleSave, "تعذر حفظ التعديلات");
  const onSuspend = guard(handleSuspend, "تعذر تعليق المدرسة");
  const onReactivate = guard(handleReactivate, "تعذر إعادة التفعيل");
  const onDelete = guard(handleDelete, "تعذر حذف المدرسة");
  const onChangeSubscriptionType = guard(handleChangeSubscriptionType, "تعذر تغيير نوع الاشتراك");

  async function sendTestNotification(deviceId: string) {
    if (testingDeviceId) return;
    setTestingDeviceId(deviceId);
    setDeliveryNotice(null);
    setActionError(null);
    try {
      await axios.post(`/api/admin/schools/${id}/notifications/test`, { deviceId });
      setDeliveryNotice("تم وضع إشعار الاختبار في قائمة الإرسال لهذا الجهاز.");
    } catch (error) {
      setActionError(describeApiError(error, "تعذر إرسال إشعار الاختبار"));
    } finally {
      setTestingDeviceId(null);
    }
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">جاري التحميل...</div>;
  if (!data) {
    return (
      <div className="p-8">
        <div
          role="alert"
          className="p-5 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300"
        >
          <p>{actionError ?? "تعذر تحميل بيانات المدرسة"}</p>
          <button
            type="button"
            onClick={() => void retryLoadSchool()}
            className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/15"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  const { school, stats, support, activityLogs, messages } = data;
  const isSuspended = school.subscription_status === "suspended";
  const storagePercent = support.storage.maxBytes
    ? Math.min(100, Math.round((support.storage.totalBytes / support.storage.maxBytes) * 100))
    : null;
  const supportAlerts = [
    support.accounts.staff.active === 0 ? "لا يوجد حساب موظف مفعل" : null,
    support.accounts.staff.expiredInvitations > 0 ? `${support.accounts.staff.expiredInvitations} دعوة موظف منتهية` : null,
    support.accounts.guardians.expiredInvitations > 0 ? `${support.accounts.guardians.expiredInvitations} دعوة ولي أمر منتهية` : null,
    support.devices.failed > 0 ? `${support.devices.failed} جهاز متوقف عن استقبال الإشعارات` : null,
    support.notifications.push.failed > 0 ? `${support.notifications.push.failed} إشعار جوال فشل خلال 30 يومًا` : null,
    support.configuration.arrivalRecipientCount === 0 ? "لم يُحدد مستلم لإشعارات الوصول" : null,
    storagePercent !== null && storagePercent >= 80 ? `مساحة التخزين وصلت إلى ${storagePercent}%` : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8">
      {actionError && (
        <div
          role="alert"
          className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300"
        >
          {actionError}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => router.push("/admin/schools")} className="text-gray-400 hover:text-white text-sm mb-2">← العودة</button>
          <h1 className="text-2xl font-bold text-white">{school.name}</h1>
        </div>
        <div className="flex gap-3">
          {!editing && <button onClick={() => setEditing(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-xl">تعديل</button>}
          {isSuspended
            ? <button onClick={onReactivate} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-xl">إعادة تفعيل</button>
            : <button onClick={() => setSuspendOpen(true)} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-xl">إيقاف مؤقت</button>
          }
          <button onClick={() => setDeleteOpen(true)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-xl">حذف</button>
        </div>
      </div>

      <section className="grid gap-4 rounded-2xl border border-indigo-500/20 bg-[#1e1e2e] p-5 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <h2 className="font-bold text-white">إدارة اشتراك المدرسة</h2>
          <p className="mt-1 text-xs leading-6 text-gray-400">
            اختيار النوع يحدّث الخطة والحالة وتاريخ الانتهاء تلقائيًا من اليوم. التجربة مدتها شهر تقويمي، وبعد الانتهاء توجد مهلة 7 أيام قبل وضع القراءة فقط.
          </p>
          <label className="mt-4 block max-w-md text-xs text-gray-400">
            نوع الاشتراك
            <select
              aria-label="نوع الاشتراك"
              value={subscriptionType}
              onChange={(event) => setSubscriptionType(event.target.value as SubscriptionType)}
              className="input-admin mt-1 w-full"
            >
              <option value="TRIAL">{SUBSCRIPTION_TYPE_LABELS.TRIAL}</option>
              <option value="MONTHLY">{SUBSCRIPTION_TYPE_LABELS.MONTHLY}</option>
              <option value="YEARLY">{SUBSCRIPTION_TYPE_LABELS.YEARLY}</option>
            </select>
          </label>
          {school.subscription_type === "UNASSIGNED" && (
            <p role="status" className="mt-2 text-xs text-amber-300">
              هذا سجل قديم بلا نوع اشتراك. اختاري النوع الصحيح لتثبيت حالته وتاريخه.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onChangeSubscriptionType}
          disabled={subscriptionSaving}
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {subscriptionSaving ? "جاري التحديث..." : "تطبيق النوع وتحديث المدة"}
        </button>
      </section>

      <Tabs.Root defaultValue="support">
        <Tabs.List className="flex gap-1 bg-[#1e1e2e] p-1 rounded-xl w-fit border border-white/5 mb-6">
          {[
            { value: "support", label: "الدعم 360" },
            { value: "delivery", label: "تشخيص الإرسال" },
            { value: "info", label: "معلومات عامة" },
            { value: "stats", label: "الإحصائيات" },
            { value: "logs", label: "سجل النشاط" },
            { value: "messages", label: "الرسائل" },
          ].map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className="px-4 py-2 text-sm text-gray-400 rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-all"
            >
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="support">
          <div className="space-y-5">
            <section className="rounded-2xl border border-indigo-500/20 bg-gradient-to-l from-indigo-500/10 to-transparent p-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-white">ملخص الدعم الفني</h2>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${supportAlerts.length ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                      {supportAlerts.length ? `${supportAlerts.length} نقاط تحتاج متابعة` : "الحالة سليمة"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-6 text-gray-400">حالة الحسابات والأجهزة والإشعارات والإعدادات في مكان واحد، دون عرض بيانات الأطفال الحساسة.</p>
                </div>
                <div className="text-xs text-gray-400">
                  آخر دخول للمنشأة: <span className="text-white">{supportDate(school.last_login_at)}</span>
                </div>
              </div>
              {supportAlerts.length > 0 && (
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {supportAlerts.map((alert) => (
                    <div key={alert} className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-200">
                      {alert}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="grid gap-5 xl:grid-cols-2">
              <SupportSection title="الحسابات والدعوات" subtitle="حالة تفعيل حسابات الموظفين وأولياء الأمور">
                <div className="grid gap-3 sm:grid-cols-2">
                  <AccountSupportCard title="الموظفون" summary={support.accounts.staff} />
                  <AccountSupportCard title="أولياء الأمور" summary={support.accounts.guardians} />
                </div>
                <div className="mt-3 rounded-xl bg-white/[0.025] px-4 py-3 text-xs text-gray-400">
                  آخر دخول لولي أمر: <span className="text-white">{supportDate(support.accounts.latestGuardianLoginAt)}</span>
                </div>
              </SupportSection>

              <SupportSection title="الأجهزة والإشعارات" subtitle={`ملخص آخر ${support.notifications.windowDays} يومًا`}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <SupportMetric label="الأجهزة" value={support.devices.total} />
                  <SupportMetric label="أجهزة سليمة" value={support.devices.healthy} tone="good" />
                  <SupportMetric label="أجهزة متوقفة" value={support.devices.failed} tone={support.devices.failed ? "bad" : "neutral"} />
                  <SupportMetric label="آخر اتصال" value={supportDate(support.devices.lastSeenAt)} compact />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <SupportMetric label="Push ناجح" value={support.notifications.push.sent} tone="good" />
                  <SupportMetric label="Push فاشل" value={support.notifications.push.failed} tone={support.notifications.push.failed ? "bad" : "neutral"} />
                  <SupportMetric label="قيد الإرسال" value={support.notifications.push.pending} />
                  <SupportMetric label="بريد/رسائل فاشلة" value={support.notifications.outbound.failed} tone={support.notifications.outbound.failed ? "bad" : "neutral"} />
                </div>
                {support.notifications.push.latestFailure && (
                  <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-xs text-red-200">
                    آخر فشل: {support.notifications.push.latestFailure} — {supportDate(support.notifications.push.latestFailureAt)}
                  </div>
                )}
              </SupportSection>

              <SupportSection title="الإعدادات التشغيلية" subtitle="الإعدادات الأكثر تأثيرًا على تجربة التطبيق">
                <div className="space-y-2">
                  <SupportRow label="تقارير الرعاية" value={support.configuration.careReportReviewRequired ? "تحتاج مراجعة المديرة" : "ترسل مباشرة لولي الأمر"} />
                  <SupportRow label="تقارير بانتظار المراجعة" value={String(support.configuration.pendingCareReportCount)} warn={support.configuration.pendingCareReportCount > 0} />
                  <SupportRow label="مستلمو إشعار الوصول" value={String(support.configuration.arrivalRecipientCount)} warn={support.configuration.arrivalRecipientCount === 0} />
                  <SupportRow label="نوع الوصول للنظام" value={school.access_mode === "active" ? "كامل" : school.access_mode === "grace" ? "فترة سماح" : "مقفل"} warn={school.access_mode !== "active"} />
                </div>
              </SupportSection>

              <SupportSection title="مساحة التخزين" subtitle="الاستخدام المسجل للمنشأة">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-2xl font-bold text-white">{formatBytes(support.storage.totalBytes)}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {support.storage.maxBytes ? `من أصل ${formatBytes(support.storage.maxBytes)}` : "الخطة بلا حد تخزين"}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400">آخر احتساب: {supportDate(support.storage.computedAt)}</div>
                </div>
                {storagePercent !== null && (
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full rounded-full ${storagePercent >= 90 ? "bg-red-500" : storagePercent >= 80 ? "bg-amber-500" : "bg-indigo-500"}`}
                      style={{ width: `${storagePercent}%` }}
                    />
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-400 sm:grid-cols-3">
                  <span>ملفات الأطفال: {formatBytes(support.storage.breakdown.studentFilesBytes)}</span>
                  <span>تقارير الرعاية: {formatBytes(support.storage.breakdown.careReportBytes)}</span>
                  <span>ملفات الموظفين: {formatBytes(support.storage.breakdown.staffFilesBytes)}</span>
                  <span>ملفات التعليم: {formatBytes(support.storage.breakdown.unitFilesBytes)}</span>
                  <span>الفواتير: {formatBytes(support.storage.breakdown.invoiceBytes)}</span>
                  <span>أخرى: {formatBytes(support.storage.breakdown.otherBytes)}</span>
                </div>
              </SupportSection>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="delivery">
          <div className="space-y-5">
            {deliveryNotice && (
              <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-200">
                {deliveryNotice}
              </div>
            )}

            <SupportSection title="الأجهزة المسجلة" subtitle="لا تظهر رموز الأجهزة السرية في لوحة الدعم">
              <div className="mb-4 rounded-xl border border-blue-500/15 bg-blue-500/[0.05] px-4 py-3 text-xs leading-6 text-blue-200">
                آخر اتصال وحالة الرمز متاحان الآن. صلاحية إشعارات نظام التشغيل ونسخة التطبيق لا يرسلهما التطبيق إلى الخادم حاليًا، لذلك لا نخمن حالتهما.
              </div>
              {support.devices.items.length === 0 ? (
                <div className="rounded-xl bg-white/[0.025] px-4 py-8 text-center text-sm text-gray-500">
                  لم يسجل التطبيق أي جهاز لهذه المنشأة بعد.
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {support.devices.items.map((device) => (
                    <div key={device.id} className="rounded-xl border border-white/5 bg-white/[0.025] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-white">{device.ownerName}</h4>
                            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-gray-400">
                              {device.ownerKind === "staff" ? "موظف" : "ولي أمر"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500" dir="ltr">{device.ownerEmail ?? "—"}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] ${device.status === "healthy" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                          {device.status === "healthy" ? "جاهز" : "متوقف"}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-400">
                        <span>المنصة: <b className="text-gray-200">{device.platform}</b></span>
                        <span>آخر اتصال: <b className="text-gray-200">{supportDate(device.lastSeenAt)}</b></span>
                        <span>تاريخ التسجيل: <b className="text-gray-200">{supportDate(device.registeredAt)}</b></span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void sendTestNotification(device.id)}
                        disabled={!device.canTest || Boolean(testingDeviceId)}
                        className="mt-4 w-full rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {testingDeviceId === device.id ? "جاري الإرسال..." : device.canTest ? "إرسال إشعار اختباري" : "الاختبار غير متاح"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </SupportSection>

            <div className="grid gap-5 xl:grid-cols-2">
              <SupportSection title="فشل إشعارات الجوال" subtitle="آخر المحاولات الفاشلة مع سبب مبسط وآمن">
                {support.notifications.push.recentFailures.length === 0 ? (
                  <div className="rounded-xl bg-emerald-500/[0.05] px-4 py-6 text-center text-sm text-emerald-300">
                    لا توجد محاولات فاشلة مسجلة.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {support.notifications.push.recentFailures.map((failure) => (
                      <div key={failure.id} className="rounded-xl bg-red-500/[0.05] px-4 py-3">
                        <div className="text-xs font-semibold text-red-200">{failure.reason ?? "فشل لدى مزود الإشعارات"}</div>
                        <div className="mt-1 text-[11px] text-gray-500">{supportDate(failure.occurredAt)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </SupportSection>

              <SupportSection title="سجل البريد والرسائل" subtitle="آخر عمليات الإرسال دون عرض محتوى الرسالة أو اسم المستلم">
                {support.notifications.outbound.recent.length === 0 ? (
                  <div className="rounded-xl bg-white/[0.025] px-4 py-6 text-center text-sm text-gray-500">
                    لا توجد عمليات إرسال مسجلة.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {support.notifications.outbound.recent.map((delivery) => (
                      <div key={delivery.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-4 py-3 text-xs">
                        <div>
                          <div className="font-semibold text-white">{delivery.type === "EMAIL" ? "بريد إلكتروني" : "واتساب"}</div>
                          <div className="mt-1 text-[11px] text-gray-500">{delivery.source} · {supportDate(delivery.sentAt)}</div>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] ${delivery.status === "SENT" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                          {delivery.status === "SENT" ? "أُرسل" : "فشل"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SupportSection>
            </div>
          </div>
        </Tabs.Content>

        {/* General Info Tab */}
        <Tabs.Content value="info">
          <div className="grid w-full max-w-6xl grid-cols-1 gap-4 rounded-2xl border border-white/5 bg-[#1e1e2e] p-5 md:grid-cols-2 md:p-6">
            {editing ? (
              <>
                <Field label="اسم المدرسة"><input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-admin" /></Field>
                <Field label="البريد الإلكتروني"><input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="input-admin" /></Field>
                <Field label="رقم التواصل الإداري"><input aria-label="رقم التواصل الإداري" value={editContactNumber} onChange={(e) => setEditContactNumber(e.target.value)} dir="ltr" className="input-admin" /></Field>
                <Field label="رقم هاتف الحضانة"><input aria-label="رقم هاتف الحضانة" value={editPhoneNumber} onChange={(e) => setEditPhoneNumber(e.target.value)} dir="ltr" className="input-admin" /></Field>
                <h3 className="text-white font-bold text-sm pt-4 border-t border-white/5 md:col-span-2">الهوية التجارية</h3>
                <Field label="الاسم القانوني"><input value={editLegalName} onChange={(e) => setEditLegalName(e.target.value)} className="input-admin" /></Field>
                <Field label="رقم السجل التجاري"><input value={editCommercialRegistration} onChange={(e) => setEditCommercialRegistration(e.target.value)} dir="ltr" className="input-admin" /></Field>
                <Field label="الرقم الوطني الموحد"><input value={editNationalUnifiedNumber} onChange={(e) => setEditNationalUnifiedNumber(e.target.value)} dir="ltr" className="input-admin" /></Field>
                <Field label="نوع الكيان">
                  <select value={editEntityType} onChange={(e) => setEditEntityType(e.target.value)} className="input-admin">
                    <option value="">— اختر —</option>
                    {ENTITY_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="الأنشطة"><input value={editBusinessActivities} onChange={(e) => setEditBusinessActivities(e.target.value)} className="input-admin" /></Field>

                <h3 className="text-white font-bold text-sm pt-4 border-t border-white/5 md:col-span-2">معلومات المدرسة</h3>
                <Field label="نوع المدرسة">
                  <select value={editSchoolType} onChange={(e) => setEditSchoolType(e.target.value)} className="input-admin">
                    <option value="">— اختر —</option>
                    {SCHOOL_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="المراحل التعليمية">
                  <div className="flex flex-wrap gap-2">
                    {EDUCATION_STAGE_OPTIONS.map((stage) => (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => toggleEditStage(stage)}
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                          editEducationStages.includes(stage)
                            ? "bg-indigo-600 border-indigo-500 text-white"
                            : "bg-[#0f0f1a] border-white/10 text-gray-400 hover:border-white/20"
                        }`}
                      >
                        {stage}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="رقم الترخيص"><input value={editLicenseNumber} onChange={(e) => setEditLicenseNumber(e.target.value)} dir="ltr" className="input-admin" /></Field>
                <Field label="الفرع"><input value={editBranch} onChange={(e) => setEditBranch(e.target.value)} className="input-admin" /></Field>
                <Field label="العنوان"><input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="input-admin" /></Field>

                <h3 className="text-white font-bold text-sm pt-4 border-t border-white/5 md:col-span-2">الضريبة والزكاة</h3>
                <Field label="مسجلة في ضريبة القيمة المضافة (VAT)؟">
                  <div className="flex gap-2">
                    {(["yes", "no"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setEditVatRegistered(v)}
                        className={`px-4 py-1.5 rounded-lg text-xs border transition-colors ${editVatRegistered === v ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#0f0f1a] border-white/10 text-gray-400 hover:border-white/20"}`}>
                        {v === "yes" ? "نعم" : "لا"}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="رقم ضريبة القيمة المضافة (VAT Number)"><input value={editVatNumber} onChange={(e) => setEditVatNumber(e.target.value)} dir="ltr" className="input-admin" /></Field>
                <Field label="الرقم الموحد لهيئة الزكاة والضريبة (ZATCA)"><input value={editZatcaUnifiedNumber} onChange={(e) => setEditZatcaUnifiedNumber(e.target.value)} dir="ltr" className="input-admin" /></Field>
                <Field label="خاضعة للزكاة؟">
                  <div className="flex gap-2">
                    {(["yes", "no", "needs_review"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setEditZakatStatus(v)}
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${editZakatStatus === v ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#0f0f1a] border-white/10 text-gray-400 hover:border-white/20"}`}>
                        {ZAKAT_STATUS_LABELS[v]}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="السنة المالية"><input value={editFinancialYear} onChange={(e) => setEditFinancialYear(e.target.value)} className="input-admin" /></Field>
                <Field label="الفترة الضريبية"><input value={editTaxPeriod} onChange={(e) => setEditTaxPeriod(e.target.value)} className="input-admin" /></Field>

                <div className="flex gap-3 pt-2 md:col-span-2">
                  <button onClick={onSave} disabled={identitySaving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm rounded-xl">{identitySaving ? "جاري الحفظ..." : "حفظ"}</button>
                  <button onClick={() => setEditing(false)} disabled={identitySaving} className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white text-sm rounded-xl">إلغاء</button>
                </div>
              </>
            ) : (
              <>
                <InfoRow label="الاسم" value={school.name} />
                <InfoRow label="البريد" value={school.email ?? "—"} />
                <InfoRow label="رقم التواصل الإداري" value={school.contactNumber ?? "—"} />
                <InfoRow label="رقم هاتف الحضانة" value={school.phoneNumber ?? "—"} />
                <InfoRow label="نوع الاشتراك" value={SUBSCRIPTION_TYPE_LABELS[school.subscription_type]} />
                <InfoRow label="الحالة" value={STATUS_LABELS[school.subscription_status] ?? school.subscription_status} />
                <InfoRow label="التجديد" value={school.renewal_date ? new Date(school.renewal_date).toLocaleDateString("ar-SA") : "—"} />
                <InfoRow label="آخر دخول" value={school.last_login_at ? new Date(school.last_login_at).toLocaleDateString("ar-SA") : "—"} />
                <InfoRow label="تاريخ التسجيل" value={new Date(school.createdAt).toLocaleDateString("ar-SA")} />
                {school.suspension_reason && <InfoRow label="سبب الإيقاف" value={school.suspension_reason} />}

                <h3 className="text-white font-bold text-sm pt-4 border-t border-white/5 md:col-span-2">الهوية التجارية</h3>
                <InfoRow label="الاسم القانوني" value={school.legalName ?? "—"} />
                <InfoRow label="رقم السجل التجاري" value={school.commercialRegistration ?? "—"} />
                <InfoRow label="الرقم الوطني الموحد" value={school.nationalUnifiedNumber ?? "—"} />
                <InfoRow label="نوع الكيان" value={school.entityType ?? "—"} />
                <InfoRow label="الأنشطة" value={school.businessActivities ?? "—"} />

                <h3 className="text-white font-bold text-sm pt-4 border-t border-white/5 md:col-span-2">معلومات المدرسة</h3>
                <InfoRow label="نوع المدرسة" value={school.schoolType ?? "—"} />
                <InfoRow label="المراحل التعليمية" value={school.educationStages?.length ? school.educationStages.join("، ") : "—"} />
                <InfoRow label="رقم الترخيص" value={school.licenseNumber ?? "—"} />
                <InfoRow label="الفرع" value={school.branch ?? "—"} />
                <InfoRow label="العنوان" value={school.address ?? "—"} />

                <h3 className="text-white font-bold text-sm pt-4 border-t border-white/5 md:col-span-2">الضريبة والزكاة</h3>
                <InfoRow label="مسجلة في VAT؟" value={school.vatRegistered === true ? "نعم" : school.vatRegistered === false ? "لا" : "—"} />
                <InfoRow label="رقم VAT" value={school.vatNumber ?? "—"} />
                <InfoRow label="الرقم الموحد (ZATCA)" value={school.zatcaUnifiedNumber ?? "—"} />
                <InfoRow label="خاضعة للزكاة؟" value={school.zakatStatus ? ZAKAT_STATUS_LABELS[school.zakatStatus] ?? school.zakatStatus : "—"} />
                <InfoRow label="السنة المالية" value={school.financialYear ?? "—"} />
                <InfoRow label="الفترة الضريبية" value={school.taxPeriod ?? "—"} />
              </>
            )}
          </div>
        </Tabs.Content>

        {/* Stats Tab */}
        <Tabs.Content value="stats">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "الطلاب", value: stats.students },
              { label: "المعلمون", value: stats.teachers },
              { label: "الفصول", value: stats.classes },
              { label: "الفواتير", value: stats.invoices },
              { label: "الإشعارات المُرسلة", value: stats.notifications },
            ].map((s) => (
              <div key={s.label} className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-5">
                <div className="text-2xl font-bold text-indigo-400">{s.value}</div>
                <div className="text-gray-400 text-xs mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </Tabs.Content>

        {/* Activity Logs Tab */}
        <Tabs.Content value="logs">
          <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">الإجراء</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">المنفذ</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {activityLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-3 text-white">{l.action}</td>
                    <td className="px-5 py-3 text-gray-400">{l.performed_by}</td>
                    <td className="px-5 py-3 text-gray-400">{new Date(l.performed_at).toLocaleString("ar-SA")}</td>
                  </tr>
                ))}
                {activityLogs.length === 0 && (
                  <tr><td colSpan={3} className="px-5 py-6 text-center text-gray-500">لا توجد سجلات</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        {/* Messages Tab */}
        <Tabs.Content value="messages">
          <div className="flex items-center justify-end mb-4">
            <button
              onClick={() => setInvoiceModalOpen(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-xl"
            >
              إنشاء فاتورة
            </button>
          </div>

          <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-white/5">
              <h4 className="text-white font-bold text-sm">الفواتير المصدرة</h4>
            </div>
            {invoices.length === 0 ? (
              <p className="text-center text-gray-500 text-sm py-8">لا توجد فواتير مصدرة بعد</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="px-5 py-3 text-right text-gray-400 font-medium">رقم الفاتورة</th>
                    <th className="px-5 py-3 text-right text-gray-400 font-medium">نوع الاشتراك</th>
                    <th className="px-5 py-3 text-right text-gray-400 font-medium">تاريخ الإصدار</th>
                    <th className="px-5 py-3 text-right text-gray-400 font-medium">المبلغ الكلي</th>
                    <th className="px-5 py-3 text-right text-gray-400 font-medium">الحالة</th>
                    <th className="px-5 py-3 text-right text-gray-400 font-medium">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-5 py-3 text-white">{inv.invoice_number}</td>
                      <td className="px-5 py-3 text-gray-400">{inv.subscription_type ?? "—"}</td>
                      <td className="px-5 py-3 text-gray-400">{new Date(inv.issue_date).toLocaleDateString("ar-SA")}</td>
                      <td className="px-5 py-3 text-gray-400">{Number(inv.total_amount).toFixed(2)} ر.س</td>
                      <td className="px-5 py-3 text-gray-400">{inv.status}</td>
                      <td className="px-5 py-3">
                        {inv.file_url && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => viewInvoicePdf(inv.file_url!)}
                              className="px-2.5 py-1 text-xs bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 rounded-lg hover:bg-indigo-600/30 transition-colors"
                            >
                              عرض
                            </button>
                            <button
                              onClick={() => downloadInvoicePdf(inv.file_url!, `فاتورة-${inv.invoice_number}`)}
                              className="px-2.5 py-1 text-xs bg-white/5 text-gray-300 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
                            >
                              تنزيل
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">الموضوع</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">النوع</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">أُرسل</th>
                  <th className="px-5 py-3 text-right text-gray-400 font-medium">قُرئ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {messages.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 text-white">{m.subject}</td>
                    <td className="px-5 py-3 text-gray-400">{m.is_automated ? "تلقائي" : "يدوي"}</td>
                    <td className="px-5 py-3 text-gray-400">{m.sent_at ? new Date(m.sent_at).toLocaleDateString("ar-SA") : "—"}</td>
                    <td className="px-5 py-3 text-gray-400">{m.read_at ? "✓" : "—"}</td>
                  </tr>
                ))}
                {messages.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-gray-500">لا توجد رسائل</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Tabs.Content>
      </Tabs.Root>

      <AdminInvoiceModal
        open={invoiceModalOpen}
        schoolId={id}
        onClose={() => setInvoiceModalOpen(false)}
        onIssued={() => loadInvoices()}
      />

      {/* Suspend Dialog */}
      {suspendOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1e1e2e] rounded-2xl p-6 w-96 border border-white/10">
            <h3 className="text-white font-bold mb-4">إيقاف مؤقت</h3>
            <textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="سبب الإيقاف..."
              className="w-full bg-[#0f0f1a] border border-white/10 rounded-xl p-3 text-white text-sm resize-none h-24 focus:outline-none"
            />
            <div className="flex gap-3 mt-4">
              <button onClick={onSuspend} disabled={!suspendReason} className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm py-2 rounded-xl">إيقاف</button>
              <button onClick={() => setSuspendOpen(false)} className="flex-1 bg-white/5 hover:bg-white/10 text-white text-sm py-2 rounded-xl">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Dialog */}
      {deleteOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1e1e2e] rounded-2xl p-6 w-96 border border-white/10">
            <h3 className="text-white font-bold mb-2">تأكيد الحذف</h3>
            <p className="text-gray-400 text-sm mb-4">اكتب اسم المدرسة لتأكيد الحذف النهائي:</p>
            <p className="text-orange-400 text-sm font-mono mb-3">{school.name}</p>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="اسم المدرسة..."
              className="w-full bg-[#0f0f1a] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={onDelete}
                disabled={deleteConfirm !== school.name}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm py-2 rounded-xl"
              >
                حذف نهائي
              </button>
              <button onClick={() => setDeleteOpen(false)} className="flex-1 bg-white/5 hover:bg-white/10 text-white text-sm py-2 rounded-xl">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-4 rounded-xl bg-white/[0.02] px-4 py-3 text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="break-words text-left text-white">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 [&_.input-admin]:w-full">
      <label className="block text-gray-400 text-xs mb-1">{label}</label>
      {children}
    </div>
  );
}

function SupportSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
      <div className="mb-4 border-b border-white/5 pb-3">
        <h3 className="text-sm font-bold text-white">{title}</h3>
        <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function AccountSupportCard({ title, summary }: { title: string; summary: AccountSummary }) {
  return (
    <div className="rounded-xl bg-white/[0.025] p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">{title}</h4>
        <span className="text-xs text-gray-500">الإجمالي {summary.total}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <SupportCount label="مفعل" value={summary.active} tone="good" />
        <SupportCount label="بانتظار التفعيل" value={summary.pending} tone={summary.pending ? "warn" : "neutral"} />
        <SupportCount label="دعوة منتهية" value={summary.expiredInvitations} tone={summary.expiredInvitations ? "bad" : "neutral"} />
        <SupportCount label="معطل" value={summary.disabled} tone={summary.disabled ? "bad" : "neutral"} />
      </div>
    </div>
  );
}

function SupportCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "good" | "warn" | "bad";
}) {
  const color = tone === "good"
    ? "text-emerald-300"
    : tone === "warn"
      ? "text-amber-300"
      : tone === "bad"
        ? "text-red-300"
        : "text-gray-300";
  return (
    <div className="rounded-lg bg-black/10 px-3 py-2">
      <div className={`font-bold ${color}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

function SupportMetric({
  label,
  value,
  tone = "neutral",
  compact = false,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "bad";
  compact?: boolean;
}) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-indigo-300";
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.025] p-3">
      <div className={`${compact ? "text-xs leading-5" : "text-xl"} break-words font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

function SupportRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-4 py-3 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={warn ? "font-semibold text-amber-300" : "text-white"}>{value}</span>
    </div>
  );
}
