"use client";

import { useEffect, useState, use, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { studentFormSchema } from "@/lib/form-schemas";
import { Topbar } from "@/components/layout/Topbar";
import { formatDate } from "@/lib/utils";
import { InvoiceModal } from "@/components/students/InvoiceModal";
import { StudentCareFeed } from "@/components/care/StudentCareFeed";
import { STUDENT_STATUS_LABELS } from "@/lib/enum-labels";
import { PAYMENT_STATUSES } from "@/lib/payment-status";
import { astDateInputValue } from "@/lib/datetime";
import { useT } from "@/lib/i18n-provider";
import { useAcademicStages, useStageName } from "@/lib/use-academic-stages";

/** ACTIVE is excluded: this is the set of reasons a child *leaves*. */
type StudentDepartureStatus = "GRADUATED" | "WITHDRAWN" | "TRANSFERRED";

const DEPARTURE_OPTIONS: StudentDepartureStatus[] = [
  "GRADUATED",
  "WITHDRAWN",
  "TRANSFERRED",
];

type Class = { id: string; name: string };
type Invoice = {
  id: string;
  type: string;
  amount: number;
  pdfUrl?: string | null;
  createdAt: string;
};
type GuardianSuggestion = { id: string; name: string; phone1?: string | null; phone2?: string | null; email?: string | null; name_2?: string | null; phone_3?: string | null; phone_4?: string | null; email_2?: string | null; students?: { id: string; name: string; avatarUrl?: string | null }[] };
type Sibling = { id: string; name: string; avatarUrl?: string | null };

type StudentData = {
  id: string;
  name: string;
  healthCondition: string | null;
  stageId: string | null;
  period: string;
  classId: string | null;
  idNumber: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  gender: string;
  registrationDate: string;
  allergies: string | null;
  guardianId: string | null;
  guardian: { id: string; name: string; phone1?: string | null; phone2?: string | null; email?: string | null; name_2?: string | null; phone_3?: string | null; phone_4?: string | null; email_2?: string | null } | null;
  registration_fee: number;
  registration_fee_is_default?: boolean;
  attendanceType: string;
  paymentMethod: string;
  enrollmentDate: string | null;
  enrollmentEndDate: string | null;
  paymentStatus: string;
  attendanceHours: number;
  lateHours: number;
  isActive: boolean;
  siblings: Sibling[];
  evaluationFileUrl?: string | null;
  evaluationFileName?: string | null;
  avatarUrl?: string | null;
};

type FormData = {
  name: string;
  healthCondition: string;
  stageId: string;
  period: string;
  classId: string;
  idNumber: string;
  dateOfBirth: string;
  nationality: string;
  gender: string;
  allergies: string;
  guardianName: string;
  guardianPhone1: string;
  guardianPhone2: string;
  guardianEmail: string;
  guardianName2: string;
  guardianPhone3: string;
  guardianPhone4: string;
  guardianEmail2: string;
  registrationFee: string;
  attendanceType: string;
  paymentMethod: string;
  enrollmentDate: string;
  enrollmentEndDate: string;
  paymentStatus: string;
};

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#111111]";
const readonlyCls = "w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500";

export default function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Locale-aware translation — see src/lib/i18n.tsx.
  const t = useT();
  const { stages } = useAcademicStages();
  const stageName = useStageName();
  const { id } = use(params);
  const router = useRouter();
  const [classes, setClasses] = useState<Class[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [student, setStudent] = useState<StudentData | null>(null);
  const [guardianId, setGuardianId] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [guardianLinked, setGuardianLinked] = useState(false);
  const [suggestions, setSuggestions] = useState<GuardianSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [trashing, setTrashing] = useState(false);
  // Enrolment departure. The date defaults to today in Riyadh terms — the value
  // an <input type="date"> expects — and drives the retention clock.
  const [showDepartureModal, setShowDepartureModal] = useState(false);
  const [departureStatus, setDepartureStatus] = useState<StudentDepartureStatus>("WITHDRAWN");
  const [departureDate, setDepartureDate] = useState(() => astDateInputValue());
  const [departing, setDeparting] = useState(false);
  const [showLateFeeConfirm, setShowLateFeeConfirm] = useState(false);
  const [evalFileUrl, setEvalFileUrl] = useState<string | null>(null);
  const [evalFileName, setEvalFileName] = useState<string | null>(null);
  const [evalUploading, setEvalUploading] = useState(false);
  const [pendingEvalFile, setPendingEvalFile] = useState<File | null>(null);
  const [showReplaceEvalConfirm, setShowReplaceEvalConfirm] = useState(false);
  const [showDeleteEvalConfirm, setShowDeleteEvalConfirm] = useState(false);
  const [evaluationError, setEvaluationError] = useState("");
  const evalFileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [registrationFeeIsDefault, setRegistrationFeeIsDefault] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Same schema as the create form — an edit that accepts what creation refuses
  // is how invalid rows get in through the side door (task 2.41).
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } =
    useForm<FormData>({
      resolver: zodResolver(studentFormSchema) as Resolver<FormData>,
    });

  useEffect(() => {
    Promise.all([
      axios.get<StudentData>(`/api/students/${id}`),
      axios.get<Invoice[]>(`/api/invoices?studentId=${id}`),
    ])
      .then(([studentRes, invRes]) => {
        const s = studentRes.data;
        setStudent(s);
        setInvoices(invRes.data);
        if (s.guardianId) {
          setGuardianId(s.guardianId);
          setGuardianLinked(true);
        }
        setEvalFileUrl(s.evaluationFileUrl ?? null);
        setEvalFileName(s.evaluationFileName ?? null);
        setAvatarUrl(s.avatarUrl ?? null);
        setRegistrationFeeIsDefault(!!s.registration_fee_is_default);
        reset({
          name: s.name,
          healthCondition: s.healthCondition ?? "",
          stageId: s.stageId ?? "",
          period: s.period,
          classId: s.classId ?? "",
          idNumber: s.idNumber ?? "",
          dateOfBirth: s.dateOfBirth ? s.dateOfBirth.slice(0, 10) : "",
          nationality: s.nationality ?? "",
          gender: s.gender,
          allergies: s.allergies ?? "",
          guardianName: s.guardian?.name ?? "",
          guardianPhone1: s.guardian?.phone1 ?? "",
          guardianPhone2: s.guardian?.phone2 ?? "",
          guardianEmail: s.guardian?.email ?? "",
          guardianName2: s.guardian?.name_2 ?? "",
          guardianPhone3: s.guardian?.phone_3 ?? "",
          guardianPhone4: s.guardian?.phone_4 ?? "",
          guardianEmail2: s.guardian?.email_2 ?? "",
          registrationFee: String(s.registration_fee ?? 0),
          attendanceType: s.attendanceType ?? t("attendanceTypes.REGULAR"),
          paymentMethod: s.paymentMethod,
          enrollmentDate: s.enrollmentDate ? s.enrollmentDate.slice(0, 10) : "",
          enrollmentEndDate: s.enrollmentEndDate ? s.enrollmentEndDate.slice(0, 10) : "",
          paymentStatus: s.paymentStatus,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, reset, t]);

  const periodVal = watch("period");

  useEffect(() => {
    if (loading) return;
    axios
      .get<Class[]>("/api/classes", { params: periodVal ? { period: periodVal } : {} })
      .then((r) => setClasses(r.data))
      .catch(() => {});
  }, [periodVal, loading]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchGuardians = useCallback((query: string) => {
    if (query.length < 3) { setSuggestions([]); setShowSuggestions(false); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await axios.post<GuardianSuggestion[]>("/api/guardians/search", { query });
        setSuggestions(res.data);
        setShowSuggestions(res.data.length > 0);
      } catch { /* ignore */ }
    }, 300);
  }, []);

  function handleGuardianFieldChange(value: string) {
    setGuardianId(null);
    setGuardianLinked(false);
    searchGuardians(value);
  }

  function handleGuardian2FieldChange(value: string) {
    if (value.length < 3) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await axios.post<GuardianSuggestion[]>("/api/guardians/search", { query: value });
        if (res.data.length === 1) selectGuardian(res.data[0]);
        else if (res.data.length > 1) { setSuggestions(res.data); setShowSuggestions(true); }
      } catch { /* ignore */ }
    }, 300);
  }

  function selectGuardian(g: GuardianSuggestion) {
    setGuardianId(g.id);
    setGuardianLinked(true);
    reset((prev) => ({
      ...prev,
      guardianName: g.name,
      guardianPhone1: g.phone1 ?? "",
      guardianPhone2: g.phone2 ?? "",
      guardianEmail: g.email ?? "",
      guardianName2: g.name_2 ?? "",
      guardianPhone3: g.phone_3 ?? "",
      guardianPhone4: g.phone_4 ?? "",
      guardianEmail2: g.email_2 ?? "",
    }));
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function onSave(data: FormData) {
    setSaving(true);
    try {
      await axios.put(`/api/students/${id}`, {
        name: data.name,
        classId: data.classId || null,
        healthCondition: data.healthCondition || null,
        stageId: data.stageId || null,
        period: data.period,
        idNumber: data.idNumber || null,
        dateOfBirth: data.dateOfBirth || null,
        nationality: data.nationality || null,
        gender: data.gender,
        allergies: data.allergies || null,
        attendanceType: data.attendanceType || t("attendanceTypes.REGULAR"),
        paymentMethod: data.paymentMethod,
        enrollmentDate: data.enrollmentDate || null,
        enrollmentEndDate: data.enrollmentEndDate || null,
        paymentStatus: data.paymentStatus,
        guardianId: guardianId || null,
        guardianName: data.guardianName || null,
        guardianPhone1: data.guardianPhone1 || null,
        guardianPhone2: data.guardianPhone2 || null,
        guardianEmail: data.guardianEmail || null,
        guardianName2: data.guardianName2 || null,
        guardianPhone3: data.guardianPhone3 || null,
        guardianPhone4: data.guardianPhone4 || null,
        guardianEmail2: data.guardianEmail2 || null,
        // See the matching note on the create form. Omitting the field here also
        // stops every profile save from regenerating the payment schedule: the
        // route treats any `registration_fee` in the body as a change and calls
        // `generatePaymentCycles`, which deletes and rebuilds the unpaid cycles.
        registration_fee: registrationFeeIsDefault
          ? undefined
          : parseFloat(data.registrationFee) || 0,
      });
      alert(t("studentProfile.saved"));
    } catch {
      alert(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function sendReminder() {
    await axios.post(`/api/students/${id}/reminder`);
    alert(t("common.sent"));
  }

  async function deleteLateFee() {
    await axios.delete(`/api/students/${id}/late-fee`);
    alert(t("studentProfile.lateFeeRemoved"));
    window.location.reload();
  }

  async function confirmDeleteLateFee() {
    setShowLateFeeConfirm(false);
    await deleteLateFee();
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setAvatarError(t("common.fileTooLarge"));
      e.target.value = "";
      return;
    }
    setAvatarError("");
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post<{ avatar_url: string }>(`/api/students/${id}/avatar`, fd);
      setAvatarUrl(res.data.avatar_url);
    } catch (err) {
      alert(axios.isAxiosError(err) ? err.response?.data?.error ?? t("common.error") : t("common.error"));
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function handleRemoveAvatar() {
    try {
      await axios.delete(`/api/students/${id}/avatar`);
      setAvatarUrl(null);
    } catch {
      alert(t("common.error"));
    }
  }

  async function uploadEvalFile(file: File) {
    setEvalUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post<{ evaluationFileUrl: string; evaluationFileName: string }>(
        `/api/students/${id}/evaluation`,
        fd
      );
      setEvalFileUrl(res.data.evaluationFileUrl);
      setEvalFileName(res.data.evaluationFileName);
    } catch {
      alert(t("common.error"));
    } finally {
      setEvalUploading(false);
      if (evalFileInputRef.current) evalFileInputRef.current.value = "";
    }
  }

  function handleEvalFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setEvaluationError(t("common.fileTooLarge"));
      e.target.value = "";
      return;
    }
    setEvaluationError("");
    if (evalFileUrl) {
      setPendingEvalFile(file);
      setShowReplaceEvalConfirm(true);
    } else {
      uploadEvalFile(file);
    }
  }

  function confirmReplaceEvalFile() {
    setShowReplaceEvalConfirm(false);
    if (pendingEvalFile) uploadEvalFile(pendingEvalFile);
    setPendingEvalFile(null);
  }

  function cancelReplaceEvalFile() {
    setShowReplaceEvalConfirm(false);
    setPendingEvalFile(null);
    if (evalFileInputRef.current) evalFileInputRef.current.value = "";
  }

  async function deleteEvalFile() {
    try {
      await axios.delete(`/api/students/${id}/evaluation`);
      setEvalFileUrl(null);
      setEvalFileName(null);
    } catch {
      alert(t("common.error"));
    } finally {
      setShowDeleteEvalConfirm(false);
    }
  }

  function issueInvoice() {
    setInvoiceModalOpen(true);
  }

  function onInvoiceIssued(invoice: { id: string; amount: number; pdfUrl: string | null; createdAt: string }) {
    setInvoices((prev) => [{ ...invoice, type: "STUDENT" }, ...prev]);
  }

  /**
   * Ends the enrolment.
   *
   * The reason and the date are asked for rather than assumed, because they are
   * the only inputs to the retention clock: the child's personal data is erased
   * five years from `leftAt`, so a wrong date here is a wrong erasure date. The
   * reason is also the sole record of *why* a child left.
   */
  async function confirmDeparture() {
    setDeparting(true);
    try {
      await axios.post(`/api/students/${id}/cancel`, {
        status: departureStatus,
        leftAt: new Date(departureDate).toISOString(),
      });
      window.location.reload();
    } catch {
      alert(t("common.error"));
      setDeparting(false);
    }
  }

  async function reactivate() {
    await axios.post(`/api/students/${id}/reactivate`);
    window.location.reload();
  }

  async function moveToTrash() {
    setTrashing(true);
    try {
      await axios.delete(`/api/students/${id}`);
      router.push("/students");
    } catch {
      alert(t("common.error"));
    } finally {
      setTrashing(false);
      setShowTrashModal(false);
    }
  }

  const guardianNameVal = watch("guardianName");

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-bg">
        <Topbar title={t("students.profile.title")} />
        <div className="flex justify-center items-center h-64">
          <div className="w-7 h-7 border-2 border-gray-200 border-t-[#F64651] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title={t("students.profile.title")} />
      <div className="p-6">
        <button
          onClick={() => router.push("/students")}
          className="mb-4 text-sm text-[#111111] hover:underline flex items-center gap-1"
        >
          ← {t("students.title")}
        </button>

        <form onSubmit={handleSubmit(onSave)}>
          <div className="flex gap-5 flex-col lg:flex-row">
            {/* Left: cards */}
            <div className="flex-1 space-y-5">
              {/* Card 1: معلومات الطالب */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-bold text-[#111111]">{t("studentProfile.studentInfo")}</h2>
                  {/* Siblings */}
                  {student?.siblings && student.siblings.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400">{t("fields.siblings")}</span>
                      {student.siblings.map((sib) => (
                        <button
                          key={sib.id}
                          type="button"
                          onClick={() => router.push(`/students/${sib.id}`)}
                          className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full hover:bg-blue-100 transition-colors"
                        >
                          <span className="w-6 h-6 rounded-full overflow-hidden bg-blue-100 flex-shrink-0">
                            {sib.avatarUrl ? (
                              <img src={sib.avatarUrl} alt={sib.name} className="w-full h-full object-cover" />
                            ) : null}
                          </span>
                          {sib.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Avatar */}
                <div className="flex flex-col items-center mb-6">
                  <div
                    className="w-24 h-24 rounded-full overflow-hidden bg-gray-100 border-2 border-gray-200 cursor-pointer relative group"
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={student?.name ?? ""} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                        <span className="text-xs mt-1">{t("studentProfile.addPhoto")}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/30 rounded-full hidden group-hover:flex items-center justify-center">
                      <span className="text-white text-xs">{avatarUploading ? "..." : t("studentProfile.change")}</span>
                    </div>
                  </div>

                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                  {avatarError && (
                    <p className="text-xs mt-1 text-right" style={{ color: "#F64651" }}>
                      {avatarError}
                    </p>
                  )}

                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      className="text-xs text-red-500 mt-1"
                    >
                      {t("common.removeImage")}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    ["name", t("students.profile.name"), "text"],
                    ["idNumber", t("students.profile.idNumber"), "text"],
                    ["nationality", t("students.profile.nationality"), "text"],
                  ].map(([field, label, type]) => (
                    <div key={field}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                      <input {...register(field as keyof FormData)} type={type} className={inputCls} />
                    </div>
                  ))}
                  {/* The school's own list, not free text (task 2.44). */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("common.academicStage")}</label>
                    <select {...register("stageId")} className={inputCls}>
                      <option value="">{t("common.noStage")}</option>
                      {stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stageName(stage)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.gender")}</label>
                    <select {...register("gender")} className={inputCls}>
                      <option value="MALE">{t("gender.MALE")}</option>
                      <option value="FEMALE">{t("gender.FEMALE")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.period")}</label>
                    <select
                      {...register("period")}
                      className={inputCls}
                      onChange={(e) => {
                        register("period").onChange(e);
                        setValue("classId", "");
                      }}
                    >
                      <option value="MORNING">{t("periods.MORNING")}</option>
                      <option value="EVENING">{t("periods.EVENING")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.class")}</label>
                    <select {...register("classId")} className={inputCls}>
                      <option value="">— {t("common.select")} —</option>
                      {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.dateOfBirth")}</label>
                    <input {...register("dateOfBirth")} type="date" dir="ltr" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.attendanceHours")}</label>
                    <input value={student?.attendanceHours ?? 0} readOnly className={readonlyCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.lateHours")}</label>
                    <input value={student?.lateHours ?? 0} readOnly className={readonlyCls} />
                  </div>
                </div>

                {/* إضافة تقييم الطفل */}
                <div className="mt-5 pt-5 border-t border-gray-100">
                  <h3 className="text-sm font-bold text-[#111111] mb-3">{t("studentProfile.addEvaluation")}</h3>
                  <input
                    ref={evalFileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={handleEvalFileChange}
                  />
                  {evaluationError && (
                    <p className="text-xs mt-1 mb-2 text-right" style={{ color: "#F64651" }}>
                      {evaluationError}
                    </p>
                  )}
                  {evalFileUrl ? (
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="text-gray-700">📄 {evalFileName}</span>
                      <button
                        type="button"
                        onClick={() => {
                          // A stored file is now a URL the browser can open: the
                          // route checks the session cookie and redirects to a
                          // signed link. Only a legacy base64 value still has to
                          // be decoded into a blob by hand.
                          if (evalFileUrl.startsWith("data:")) {
                            const base64 = evalFileUrl.split(",")[1];
                            const mime = evalFileUrl.slice(5, evalFileUrl.indexOf(";"));
                            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
                            window.open(URL.createObjectURL(new Blob([bytes], { type: mime })), "_blank");
                            return;
                          }
                          window.open(evalFileUrl, "_blank");
                        }}
                        className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        {t("common.view")}
                      </button>
                      <button
                        type="button"
                        onClick={() => evalFileInputRef.current?.click()}
                        disabled={evalUploading}
                        className="px-2.5 py-1 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
                      >
                        {evalUploading ? t("studentProfile.uploading") : t("fields.chooseFile")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteEvalConfirm(true)}
                        className="px-2.5 py-1 text-xs border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => evalFileInputRef.current?.click()}
                      disabled={evalUploading}
                      className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
                    >
                      {evalUploading ? t("studentProfile.uploading") : t("fields.chooseFile")}
                    </button>
                  )}
                </div>
              </div>

              {/* Card 2: المعلومات الصحية */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-base font-bold text-[#111111] mb-5">{t("fields.healthInfo")}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.healthCondition")}</label>
                    <input {...register("healthCondition")} type="text" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.allergies")}</label>
                    <input {...register("allergies")} type="text" className={inputCls} />
                  </div>
                </div>
              </div>

              {/* Card 3: معلومات ولي الأمر */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-bold text-[#111111]">{t("studentProfile.guardianInfo")}</h2>
                  {guardianLinked && (
                    <span className="text-xs bg-success-bg text-success-text border border-success-text/20 px-3 py-1 rounded-full font-medium">
                      {t("studentProfile.guardianLinked")}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.guardianName")}</label>
                    <input
                      {...register("guardianName")}
                      type="text"
                      className={inputCls}
                      autoComplete="off"
                      onChange={(e) => {
                        register("guardianName").onChange(e);
                        handleGuardianFieldChange(e.target.value);
                      }}
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div
                        ref={suggestionsRef}
                        className="absolute z-20 top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
                      >
                        {suggestions.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => selectGuardian(g)}
                            className="w-full text-right px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="font-medium text-[#111111]">{g.name}</div>
                                <div className="text-xs text-gray-400">{[g.phone1, g.email].filter(Boolean).join(" · ")}</div>
                              </div>
                              {g.students && g.students.length > 0 && (
                                <div className="flex items-center -space-x-2 rtl:space-x-reverse flex-shrink-0">
                                  {g.students.slice(0, 4).map((child) => (
                                    <div
                                      key={child.id}
                                      title={child.name}
                                      className="w-6 h-6 rounded-full overflow-hidden bg-gray-100 border border-white"
                                    >
                                      {child.avatarUrl ? (
                                        <img src={child.avatarUrl} alt={child.name} className="w-full h-full object-cover" />
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.phone1")}</label>
                    <input
                      {...register("guardianPhone1")}
                      type="tel"
                      dir="ltr"
                      className={inputCls}
                      onChange={(e) => {
                        register("guardianPhone1").onChange(e);
                        if (!guardianNameVal) handleGuardianFieldChange(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.phone2")}</label>
                    <input {...register("guardianPhone2")} type="tel" dir="ltr" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.email")}</label>
                    <input
                      {...register("guardianEmail")}
                      type="email"
                      dir="ltr"
                      className={inputCls}
                      onChange={(e) => {
                        register("guardianEmail").onChange(e);
                        if (!guardianNameVal) handleGuardianFieldChange(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("fields.guardianName2")}</label>
                    <input {...register("guardianName2")} type="text" className={inputCls}
                      onChange={(e) => { register("guardianName2").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("studentProfile.phone3")}</label>
                    <input {...register("guardianPhone3")} type="tel" dir="ltr" className={inputCls}
                      onChange={(e) => { register("guardianPhone3").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("studentProfile.phone4")}</label>
                    <input {...register("guardianPhone4")} type="tel" dir="ltr" className={inputCls}
                      onChange={(e) => { register("guardianPhone4").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("fields.email2")}</label>
                    <input {...register("guardianEmail2")} type="email" dir="ltr" className={inputCls}
                      onChange={(e) => { register("guardianEmail2").onChange(e); handleGuardian2FieldChange(e.target.value); }} />
                  </div>
                </div>
              </div>

              {/* Card 4: معلومات التسجيل */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-base font-bold text-[#111111] mb-5">{t("studentProfile.enrollmentInfo")}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("studentProfile.attendanceType")}</label>
                    <select {...register("attendanceType")} className={inputCls}>
                      <option value="دوام منتظم">{t("attendanceTypes.REGULAR")}</option>
                      <option value="شفتات">{t("attendanceTypes.SHIFTS")}</option>
                      <option value="غيره">{t("attendanceTypes.OTHER")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.paymentMethod")}</label>
                    <select {...register("paymentMethod")} className={inputCls}>
                      <option value="CASH">{t("paymentMethod.CASH")}</option>
                      <option value="TRANSFER">{t("paymentMethod.TRANSFER")}</option>
                      <option value="CARD">{t("paymentMethod.CARD")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("studentProfile.paymentStatusLabel")}</label>
                    {/* Generated from the enum — see the note on the create form. */}
                    <select {...register("paymentStatus")} className={inputCls}>
                      {PAYMENT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {t(`paymentStatus.${status}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("fields.joinDate")}</label>
                    <input {...register("enrollmentDate")} type="date" dir="ltr" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("students.profile.enrollmentEndDate")}</label>
                    <input {...register("enrollmentEndDate")} type="date" dir="ltr" className={inputCls} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-500">{t("studentProfile.registrationFee")}</label>
                      <span className="text-xs text-gray-400">
                        {registrationFeeIsDefault ? t("fields.fromSettings") : t("fields.custom")}
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        {...register("registrationFee")}
                        type="number"
                        min="0"
                        step="0.01"
                        dir="ltr"
                        className={`${inputCls} pl-14`}
                        onChange={(e) => {
                          register("registrationFee").onChange(e);
                          setRegistrationFeeIsDefault(false);
                        }}
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{t("common.sar")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: action sidebar */}
            <div className="w-full lg:w-64 space-y-3 self-start">
              <div className="bg-white rounded-xl shadow-md p-5">
                <div className="flex flex-col gap-3 w-full">
                  {/* 1. حفظ التغييرات */}
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full px-5 py-2.5 rounded-md bg-coral text-white font-medium text-sm
                               hover:bg-coral-dark active:scale-[0.98] transition-all disabled:opacity-60"
                  >
                    {saving ? t("common.loading") : t("students.profile.actions.save")}
                  </button>

                  {/* 2. ارسال تذكير بالدفع */}
                  <button
                    type="button"
                    onClick={sendReminder}
                    className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                               border border-[#666666] text-[#666666]
                               hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA]
                               active:scale-[0.98] transition-all"
                  >
                    {t("students.profile.actions.sendPaymentReminder")}
                  </button>

                  {/* 3. إصدار فاتورة */}
                  <button
                    type="button"
                    onClick={issueInvoice}
                    className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                               border border-[#666666] text-[#666666]
                               hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA]
                               active:scale-[0.98] transition-all"
                  >
                    {t("students.profile.actions.issueInvoice")}
                  </button>

                  {/* 4. إلغاء الاشتراك / إعادة التفعيل */}
                  {student?.isActive ? (
                    <button
                      type="button"
                      onClick={() => setShowDepartureModal(true)}
                      className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                                 border border-[#666666] text-[#666666]
                                 hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA]
                                 active:scale-[0.98] transition-all"
                    >
                      {t("students.profile.actions.cancel")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={reactivate}
                      className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                                 border border-[#666666] text-[#666666]
                                 hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA]
                                 active:scale-[0.98] transition-all"
                    >
                      {t("students.profile.actions.reactivate")}
                    </button>
                  )}

                  {/* 5. حذف رسوم التأخير */}
                  <button
                    type="button"
                    onClick={() => setShowLateFeeConfirm(true)}
                    className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                               border border-[#666666] text-[#666666]
                               hover:border-[#2F96A6] hover:text-[#2F96A6] hover:bg-[#E0F7FA]
                               active:scale-[0.98] transition-all"
                  >
                    {t("students.profile.actions.deleteLateFee")}
                  </button>

                  {/* 6. نقل إلى سلة المحذوفات */}
                  <button
                    type="button"
                    onClick={() => setShowTrashModal(true)}
                    className="w-full px-5 py-2.5 rounded-md bg-white font-medium text-sm
                               border border-[#666666] text-[#666666]
                               hover:border-[#F64651] hover:text-[#F64651] hover:bg-[#FFE8EA]
                               active:scale-[0.98] transition-all"
                  >
                    {t("classes.moveToTrash")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>

        {showDepartureModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-96 space-y-4" dir="rtl">
              <p className="text-base font-bold text-[#111111] text-center">{t("studentProfile.endEnrollment")}</p>

              <div>
                <label className="block text-sm text-gray-600 mb-1">{t("studentProfile.departureReason")}</label>
                <select
                  value={departureStatus}
                  onChange={(e) => setDepartureStatus(e.target.value as StudentDepartureStatus)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                >
                  {DEPARTURE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {STUDENT_STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">{t("studentProfile.departureDate")}</label>
                <input
                  type="date"
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>

              {/* Stated up front: this date is what the erasure schedule counts
                  from, and it is not obvious from a form labelled "cancel". */}
              <p className="text-xs text-gray-500 leading-relaxed">
                {t("studentProfile.retentionNotice")}
              </p>

              <div className="flex gap-3 justify-center pt-1">
                <button
                  onClick={confirmDeparture}
                  disabled={departing || !departureDate}
                  className="px-5 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e] disabled:opacity-60"
                >
                  {departing ? "..." : t("common.confirm")}
                </button>
                <button
                  onClick={() => setShowDepartureModal(false)}
                  className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        {showTrashModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
              <p className="text-base font-bold text-[#111111]">{t("studentProfile.moveToTrash")}</p>
              <p className="text-sm text-gray-600 whitespace-pre-line">
                {t("studentProfile.trashNotice", { name: student?.name ?? "" })}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={moveToTrash}
                  disabled={trashing}
                  className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-60"
                >
                  {trashing ? "..." : t("studentProfile.confirmMove")}
                </button>
                <button
                  onClick={() => setShowTrashModal(false)}
                  className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        {showLateFeeConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
              <p className="text-base font-bold text-[#111111]">{t("studentProfile.removeLateFee")}</p>
              <p className="text-sm text-gray-600">{t("studentProfile.removeLateFeeAsk")}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={confirmDeleteLateFee}
                  className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600"
                >
                  {t("common.delete")}
                </button>
                <button
                  onClick={() => setShowLateFeeConfirm(false)}
                  className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        {showReplaceEvalConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
              <p className="text-base font-bold text-[#111111]">{t("studentProfile.replaceFile")}</p>
              <p className="text-sm text-gray-600 whitespace-pre-line">
                {t("studentProfile.replaceEvalConfirm", { name: evalFileName ?? "" })}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={confirmReplaceEvalFile}
                  className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600"
                >
                  {t("common.replace")}
                </button>
                <button
                  onClick={cancelReplaceEvalFile}
                  className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        {showDeleteEvalConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-96 text-center space-y-4">
              <p className="text-base font-bold text-[#111111]">{t("studentProfile.deleteEvaluation")}</p>
              <p className="text-sm text-gray-600">{t("studentProfile.deleteEvalConfirm", { name: evalFileName ?? "" })}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={deleteEvalFile}
                  className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600"
                >
                  {t("common.delete")}
                </button>
                <button
                  onClick={() => setShowDeleteEvalConfirm(false)}
                  className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        <InvoiceModal
          open={invoiceModalOpen}
          studentId={id}
          onClose={() => setInvoiceModalOpen(false)}
          onIssued={onInvoiceIssued}
        />

        {/* Daily care reports — grouped by day. */}
        <div className="mt-5 bg-white rounded-xl shadow-md p-6">
          <h3 className="text-base font-bold text-[#111111] mb-4">{t("care.title")}</h3>
          <StudentCareFeed studentId={id} />
        </div>

        {/* Invoices */}
        <div className="mt-5 bg-white rounded-xl shadow-md p-6">
          <h3 className="text-base font-bold text-[#111111] mb-4">{t("students.profile.invoices")}</h3>
          {invoices.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">{t("common.noData")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="py-2 text-right">#</th>
                  <th className="py-2 text-right">{t("invoices.issuedAt")}</th>
                  <th className="py-2 text-right">{t("finance.amount")}</th>
                  <th className="py-2 text-right">{t("fields.action")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => (
                  <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2">{formatDate(inv.createdAt)}</td>
                    <td className="py-2">{inv.amount.toLocaleString("ar-SA")} ر.س</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        {inv.pdfUrl && (
                          <>
                            <button
                              onClick={() => {
                                const base64 = inv.pdfUrl!.split(",")[1];
                                const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
                                const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
                                window.open(url, "_blank");
                              }}
                              className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                            >{t("finance.view")}</button>
                            <button
                              onClick={() => {
                                const link = document.createElement("a");
                                link.href = inv.pdfUrl!;
                                link.download = t("studentProfile.invoiceFilename", { n: String(i + 1) });
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                              }}
                              className="px-2.5 py-1 text-xs bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                            >{t("finance.download")}</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
