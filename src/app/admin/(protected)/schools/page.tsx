"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useLocale, useT } from "@/lib/i18n-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/Dialog";

type InvitationStatus = "active" | "pending" | "expired" | "revoked" | "none";

interface SchoolRow {
  id: string;
  name: string;
  email: string | null;
  plan: { id: string; name: string; price: number } | null;
  subscription_status: string;
  renewal_date: string | null;
  last_login_at: string | null;
  createdAt: string;
  studentCount: number;
  teacherCount: number;
  invitation_status: InvitationStatus;
}

interface CreatedAccount {
  name: string;
  email: string;
  emailDelivery: "sent" | "failed";
}

interface CreateSchoolResponse {
  id: string;
  name: string;
  email: string;
  invitationStatus: "pending";
  emailDelivery: "sent" | "failed";
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "bg-emerald-500/20 text-emerald-300" },
  suspended: { label: "موقوف", cls: "bg-orange-500/20 text-orange-300" },
  expired: { label: "منتهٍ", cls: "bg-red-500/20 text-red-300" },
  trial: { label: "تجريبي", cls: "bg-blue-500/20 text-blue-300" },
};

const EDUCATION_STAGE_OPTIONS = ["حضانة", "تمهيدي", "رياض أطفال", "ابتدائي"];
const ENTITY_TYPE_OPTIONS = ["مؤسسة فردية", "شركة ذات مسؤولية محدودة", "شركة مساهمة", "شركة تضامن", "أخرى"];
const SCHOOL_TYPE_OPTIONS = ["حضانة", "روضة أطفال", "مركز رعاية نهارية", "أخرى"];

const inputCls = "w-full bg-[#0f0f1a] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors";

interface CreateSchoolForm {
  schoolName: string;
  email: string;
  contactNumber: string;
  legalName: string;
  commercialRegistration: string;
  nationalUnifiedNumber: string;
  entityType: string;
  businessActivities: string;
  schoolType: string;
  educationStages: string[];
  licenseNumber: string;
  branch: string;
  address: string;
  vatRegistered: "" | "yes" | "no";
  vatNumber: string;
  zatcaUnifiedNumber: string;
  zakatStatus: "" | "yes" | "no" | "needs_review";
  financialYear: string;
  taxPeriod: string;
}

const EMPTY_FORM: CreateSchoolForm = {
  schoolName: "", email: "", contactNumber: "",
  legalName: "", commercialRegistration: "", nationalUnifiedNumber: "", entityType: "", businessActivities: "",
  schoolType: "", educationStages: [], licenseNumber: "", branch: "", address: "",
  vatRegistered: "", vatNumber: "", zatcaUnifiedNumber: "", zakatStatus: "", financialYear: "", taxPeriod: "",
};

const WIZARD_STEPS = ["بيانات الحساب", "الهوية التجارية", "معلومات المدرسة", "الضريبة والزكاة"];

function CreateSchoolModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: SchoolRow) => void }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CreateSchoolForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedAccount | null>(null);

  function set<K extends keyof CreateSchoolForm>(key: K, value: CreateSchoolForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleStage(stage: string) {
    setForm((prev) => ({
      ...prev,
      educationStages: prev.educationStages.includes(stage)
        ? prev.educationStages.filter((s) => s !== stage)
        : [...prev.educationStages, stage],
    }));
  }

  const canProceedStep0 = form.schoolName.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      const res = await axios.post<CreateSchoolResponse>("/api/admin/schools", {
        schoolName: form.schoolName,
        email: form.email,
        contactNumber: form.contactNumber || undefined,
        legalName: form.legalName || undefined,
        commercialRegistration: form.commercialRegistration || undefined,
        nationalUnifiedNumber: form.nationalUnifiedNumber || undefined,
        entityType: form.entityType || undefined,
        businessActivities: form.businessActivities || undefined,
        schoolType: form.schoolType || undefined,
        educationStages: form.educationStages.length ? form.educationStages : undefined,
        licenseNumber: form.licenseNumber || undefined,
        branch: form.branch || undefined,
        address: form.address || undefined,
        vatRegistered: form.vatRegistered ? form.vatRegistered === "yes" : undefined,
        vatNumber: form.vatNumber || undefined,
        zatcaUnifiedNumber: form.zatcaUnifiedNumber || undefined,
        zakatStatus: form.zakatStatus || undefined,
        financialYear: form.financialYear || undefined,
        taxPeriod: form.taxPeriod || undefined,
      });
      setCreated({
        name: res.data.name,
        email: res.data.email,
        emailDelivery: res.data.emailDelivery,
      });
      onCreated({
        id: res.data.id,
        name: res.data.name,
        email: res.data.email,
        plan: null,
        subscription_status: "active",
        renewal_date: null,
        last_login_at: null,
        createdAt: new Date().toISOString(),
        studentCount: 0,
        teacherCount: 0,
        invitation_status: "pending",
      });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError(t("adminSchools.duplicateEmail"));
      } else {
        setError(t("adminSchools.genericError"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogContent
      dismissBlocked={loading}
      className="max-w-lg border border-white/10 bg-[#1e1e2e] p-6 text-white shadow-2xl"
      overlayClassName="bg-black/60"
    >
        <DialogHeader className="mb-5">
          <div>
            <DialogTitle className="text-white">{t("adminSchools.createTitle")}</DialogTitle>
            <DialogDescription className="mt-1 text-gray-400">
              {t("adminSchools.createDescription")}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label={t("adminSchools.close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xl font-bold text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            ×
          </button>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div
              role="status"
              className={`rounded-xl border p-4 space-y-2 ${
                created.emailDelivery === "sent"
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-amber-500/30 bg-amber-500/10"
              }`}
            >
              <p className={`font-bold text-sm ${created.emailDelivery === "sent" ? "text-emerald-400" : "text-amber-300"}`}>
                {created.emailDelivery === "sent"
                  ? t("adminSchools.createdSentTitle")
                  : t("adminSchools.createdFailedTitle")}
              </p>
              <p className="text-gray-300 text-sm">{t("adminSchools.schoolLabel")}: <span className="text-white font-medium">{created.name}</span></p>
              <p className="text-gray-300 text-sm">{t("adminSchools.emailLabel")}: <span className="text-white font-medium" dir="ltr">{created.email}</span></p>
              <p className="text-gray-400 text-xs mt-2">
                {created.emailDelivery === "sent"
                  ? t("adminSchools.createdSentBody")
                  : t("adminSchools.createdFailedBody")}
              </p>
            </div>
            <button onClick={onClose} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-colors">
              {t("adminSchools.close")}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Step indicator */}
            <div className="flex items-center gap-2">
              {WIZARD_STEPS.map((label, i) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className={`w-full h-1.5 rounded-full ${i <= step ? "bg-indigo-500" : "bg-white/10"}`} />
                  <span className={`text-[10px] text-center ${i === step ? "text-white font-medium" : "text-gray-500"}`}>{label}</span>
                </div>
              ))}
            </div>

            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">اسم المنشأة *</label>
                  <input value={form.schoolName} onChange={(e) => set("schoolName", e.target.value)} required placeholder="روضة النور" className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">البريد الإلكتروني *</label>
                  <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required placeholder="admin@school.com" dir="ltr" className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">رقم الجوال (اختياري)</label>
                  <input type="tel" value={form.contactNumber} onChange={(e) => set("contactNumber", e.target.value)} placeholder="05xxxxxxxx" dir="ltr" className={inputCls} />
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <p className="text-gray-500 text-xs -mt-1">جميع الحقول التالية اختيارية ويمكن تعديلها لاحقاً.</p>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">الاسم القانوني</label>
                  <input value={form.legalName} onChange={(e) => set("legalName", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">رقم السجل التجاري</label>
                  <input value={form.commercialRegistration} onChange={(e) => set("commercialRegistration", e.target.value)} dir="ltr" className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">الرقم الوطني الموحد</label>
                  <input value={form.nationalUnifiedNumber} onChange={(e) => set("nationalUnifiedNumber", e.target.value)} dir="ltr" className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">نوع الكيان</label>
                  <select value={form.entityType} onChange={(e) => set("entityType", e.target.value)} className={inputCls}>
                    <option value="">— اختر —</option>
                    {ENTITY_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">الأنشطة</label>
                  <input value={form.businessActivities} onChange={(e) => set("businessActivities", e.target.value)} placeholder="مثال: رعاية وتعليم الأطفال" className={inputCls} />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <p className="text-gray-500 text-xs -mt-1">جميع الحقول التالية اختيارية ويمكن تعديلها لاحقاً.</p>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">نوع المدرسة</label>
                  <select value={form.schoolType} onChange={(e) => set("schoolType", e.target.value)} className={inputCls}>
                    <option value="">— اختر —</option>
                    {SCHOOL_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">المراحل التعليمية</label>
                  <div className="flex flex-wrap gap-2">
                    {EDUCATION_STAGE_OPTIONS.map((stage) => (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => toggleStage(stage)}
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                          form.educationStages.includes(stage)
                            ? "bg-indigo-600 border-indigo-500 text-white"
                            : "bg-[#0f0f1a] border-white/10 text-gray-400 hover:border-white/20"
                        }`}
                      >
                        {stage}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">رقم الترخيص</label>
                  <input value={form.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} dir="ltr" className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">الفرع</label>
                  <input value={form.branch} onChange={(e) => set("branch", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">العنوان</label>
                  <input value={form.address} onChange={(e) => set("address", e.target.value)} className={inputCls} />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <p className="text-gray-500 text-xs -mt-1">جميع الحقول التالية اختيارية ويمكن تعديلها لاحقاً.</p>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">هل المنشأة مسجلة في ضريبة القيمة المضافة (VAT)؟</label>
                  <div className="flex gap-2">
                    {(["yes", "no"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => set("vatRegistered", v)}
                        className={`px-4 py-1.5 rounded-lg text-xs border transition-colors ${
                          form.vatRegistered === v ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#0f0f1a] border-white/10 text-gray-400 hover:border-white/20"
                        }`}
                      >
                        {v === "yes" ? "نعم" : "لا"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">رقم ضريبة القيمة المضافة (VAT Number)</label>
                  <input value={form.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} dir="ltr" className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">الرقم الموحد لهيئة الزكاة والضريبة (ZATCA)</label>
                  <input value={form.zatcaUnifiedNumber} onChange={(e) => set("zatcaUnifiedNumber", e.target.value)} dir="ltr" className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">هل المنشأة خاضعة للزكاة؟</label>
                  <div className="flex gap-2">
                    {(["yes", "no", "needs_review"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => set("zakatStatus", v)}
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                          form.zakatStatus === v ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#0f0f1a] border-white/10 text-gray-400 hover:border-white/20"
                        }`}
                      >
                        {v === "yes" ? "نعم" : v === "no" ? "لا" : "يحتاج مراجعة"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">السنة المالية</label>
                  <input value={form.financialYear} onChange={(e) => set("financialYear", e.target.value)} placeholder="مثال: 2026" className={inputCls} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">الفترة الضريبية</label>
                  <input value={form.taxPeriod} onChange={(e) => set("taxPeriod", e.target.value)} placeholder="مثال: شهري" className={inputCls} />
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400 text-center">{error}</div>
            )}

            <div className="flex gap-3 pt-1">
              {step > 0 && (
                <button type="button" onClick={() => setStep((s) => s - 1)} className="px-5 py-2.5 border border-white/10 rounded-xl text-sm text-gray-400 hover:bg-white/5 transition-colors">
                  {t("adminSchools.previous")}
                </button>
              )}
              {step < WIZARD_STEPS.length - 1 ? (
                <button
                  type="button"
                  disabled={step === 0 && !canProceedStep0}
                  onClick={() => setStep((s) => s + 1)}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-40"
                >
                  {t("adminSchools.next")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSubmit}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-60"
                >
                  {loading ? t("adminSchools.submitting") : t("adminSchools.submit")}
                </button>
              )}
              <button type="button" disabled={loading} onClick={onClose} className="px-5 py-2.5 border border-white/10 rounded-xl text-sm text-gray-400 hover:bg-white/5 transition-colors disabled:opacity-50">
                {t("adminSchools.cancel")}
              </button>
            </div>
          </div>
        )}
    </DialogContent>
  );
}

export default function AdminSchoolsPage() {
  const t = useT();
  const { locale } = useLocale();
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resending, setResending] = useState<Record<string, boolean>>({});
  const [inviteMessages, setInviteMessages] = useState<
    Record<string, { kind: "success" | "warning" | "error"; text: string }>
  >({});
  const resendInFlight = useRef(new Set<string>());

  useEffect(() => {
    axios.get<SchoolRow[]>("/api/admin/schools").then((r) => setSchools(r.data)).finally(() => setLoading(false));
  }, []);

  const filtered = schools.filter((s) => {
    const matchSearch = !search || s.name.includes(search) || (s.email?.includes(search) ?? false);
    const matchStatus = !statusFilter || s.subscription_status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function resendInvitation(school: SchoolRow) {
    if (school.invitation_status === "active" || resendInFlight.current.has(school.id)) {
      return;
    }

    resendInFlight.current.add(school.id);
    setResending((current) => ({ ...current, [school.id]: true }));
    setInviteMessages((current) => {
      const next = { ...current };
      delete next[school.id];
      return next;
    });

    try {
      const response = await axios.post<{
        invitationStatus: "pending";
        emailDelivery: "sent" | "failed";
      }>(`/api/admin/schools/${school.id}/invite`);

      setSchools((current) =>
        current.map((item) =>
          item.id === school.id
            ? { ...item, invitation_status: response.data.invitationStatus }
            : item
        )
      );
      setInviteMessages((current) => ({
        ...current,
        [school.id]: {
          kind: response.data.emailDelivery === "sent" ? "success" : "warning",
          text:
            response.data.emailDelivery === "sent"
              ? t("adminSchools.resendSent")
              : t("adminSchools.resendFailed"),
        },
      }));
    } catch {
      setInviteMessages((current) => ({
        ...current,
        [school.id]: { kind: "error", text: t("adminSchools.resendError") },
      }));
    } finally {
      resendInFlight.current.delete(school.id);
      setResending((current) => ({ ...current, [school.id]: false }));
    }
  }

  return (
    <Dialog open={showCreate} onOpenChange={setShowCreate}>
    <div className="p-8 space-y-6">
      {showCreate && (
        <CreateSchoolModal
          onClose={() => setShowCreate(false)}
          onCreated={(s) => setSchools((prev) => [s, ...prev])}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("adminSchools.title")}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {t("adminSchools.registeredCount", { count: schools.length })}
          </p>
        </div>
        <DialogTrigger asChild>
          <button
            type="button"
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-colors"
          >
            + {t("adminSchools.createAccount")}
          </button>
        </DialogTrigger>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("adminSchools.searchPlaceholder")}
          className="bg-[#1e1e2e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 w-72"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#1e1e2e] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="">{t("adminSchools.allStatuses")}</option>
          <option value="active">نشط</option>
          <option value="suspended">موقوف</option>
          <option value="expired">منتهٍ</option>
          <option value="trial">تجريبي</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400 text-sm text-center">{t("adminSchools.loading")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-5 py-4 text-start text-gray-400 font-medium">{t("adminSchools.school")}</th>
                <th className="px-5 py-4 text-start text-gray-400 font-medium">{t("adminSchools.plan")}</th>
                <th className="px-5 py-4 text-start text-gray-400 font-medium">{t("adminSchools.subscriptionStatus")}</th>
                <th className="px-5 py-4 text-start text-gray-400 font-medium">{t("adminSchools.invitation")}</th>
                <th className="px-5 py-4 text-start text-gray-400 font-medium">{t("adminSchools.students")}</th>
                <th className="px-5 py-4 text-start text-gray-400 font-medium">{t("adminSchools.renewal")}</th>
                <th className="px-5 py-4 text-start text-gray-400 font-medium">{t("adminSchools.lastLogin")}</th>
                <th className="px-5 py-4 text-start text-gray-400 font-medium">{t("adminSchools.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((s) => {
                const status = STATUS_LABELS[s.subscription_status] ?? { label: s.subscription_status, cls: "bg-gray-500/20 text-gray-300" };
                return (
                  <tr key={s.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-5 py-4">
                      <div className="text-white font-medium">{s.name}</div>
                      {s.email && <div className="text-gray-500 text-xs">{s.email}</div>}
                    </td>
                    <td className="px-5 py-4 text-gray-300">{s.plan?.name ?? "—"}</td>
                    <td className="px-5 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${status.cls}`}>{status.label}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          s.invitation_status === "active"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : s.invitation_status === "pending"
                              ? "bg-blue-500/20 text-blue-300"
                              : s.invitation_status === "expired"
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-gray-500/20 text-gray-300"
                        }`}
                      >
                        {t(`adminSchools.invitationStatus.${s.invitation_status}`)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-300">{s.studentCount}</td>
                    <td className="px-5 py-4 text-gray-300">
                      {s.renewal_date ? new Date(s.renewal_date).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US") : "—"}
                    </td>
                    <td className="px-5 py-4 text-gray-300">
                      {s.last_login_at ? new Date(s.last_login_at).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US") : "—"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex min-w-36 flex-col items-start gap-2">
                        <Link href={`/admin/schools/${s.id}`} className="text-indigo-400 hover:text-indigo-300 text-xs font-medium">
                          {t("adminSchools.view")}
                        </Link>
                        {s.invitation_status !== "active" && (
                          <button
                            type="button"
                            disabled={Boolean(resending[s.id])}
                            onClick={() => resendInvitation(s)}
                            className="text-xs font-medium text-amber-300 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {resending[s.id]
                              ? t("adminSchools.resending")
                              : t("adminSchools.resend")}
                          </button>
                        )}
                        {inviteMessages[s.id] && (
                          <p
                            role={inviteMessages[s.id].kind === "error" ? "alert" : "status"}
                            className={`max-w-52 text-xs ${
                              inviteMessages[s.id].kind === "success"
                                ? "text-emerald-300"
                                : inviteMessages[s.id].kind === "warning"
                                  ? "text-amber-300"
                                  : "text-red-300"
                            }`}
                          >
                            {inviteMessages[s.id].text}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-gray-500">{t("adminSchools.noResults")}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
    </Dialog>
  );
}
