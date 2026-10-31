"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { describeApiError } from "@/lib/api-error";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

interface TicketSummary {
  id: string;
  reference: string;
  title: string;
  category: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  school: { id: string; name: string } | null;
  requesterUser: { id: string; name: string; email: string } | null;
  assignedAdmin: { id: string; email: string } | null;
  _count: { notes: number; attachments: number; accessSessions: number };
}

interface TicketDetail extends Omit<TicketSummary, "_count"> {
  description: string;
  school: { id: string; name: string; subscription_status: string } | null;
  notes: Array<{ id: string; body: string; isInternal: boolean; createdAt: string; authorAdmin: { email: string } }>;
  attachments: Array<{ id: string; fileName: string; fileUrl: string; contentType: string; sizeBytes: number; createdAt: string }>;
  accessSessions: Array<{ id: string; reason: string; createdAt: string; expiresAt: string; revokedAt: string | null }>;
}

interface SupportData {
  tickets: TicketSummary[];
  schools: Array<{ id: string; name: string; subscription_status: string }>;
  admins: Array<{ id: string; email: string }>;
  summary: { open: number; inProgress: number; waiting: number; resolved: number; urgentOpen: number };
}

const STATUS: Record<TicketStatus, { label: string; classes: string }> = {
  OPEN: { label: "جديدة", classes: "bg-sky-500/10 text-sky-300" },
  IN_PROGRESS: { label: "قيد المعالجة", classes: "bg-indigo-500/10 text-indigo-300" },
  WAITING_CUSTOMER: { label: "بانتظار المنشأة", classes: "bg-amber-500/10 text-amber-300" },
  RESOLVED: { label: "تم الحل", classes: "bg-emerald-500/10 text-emerald-300" },
  CLOSED: { label: "مغلقة", classes: "bg-slate-500/10 text-slate-300" },
};

const PRIORITY: Record<TicketPriority, { label: string; classes: string }> = {
  LOW: { label: "منخفضة", classes: "text-slate-300" },
  NORMAL: { label: "عادية", classes: "text-blue-300" },
  HIGH: { label: "عالية", classes: "text-orange-300" },
  URGENT: { label: "عاجلة", classes: "text-red-300" },
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} ك.ب` : `${(bytes / 1024 / 1024).toFixed(1)} م.ب`;
}

export default function SupportCenterPage() {
  const router = useRouter();
  const [data, setData] = useState<SupportData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | TicketStatus>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ schoolId: "", title: "", description: "", category: "", priority: "NORMAL" as TicketPriority });
  const [note, setNote] = useState("");
  const [accessReason, setAccessReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get<SupportData>("/api/admin/support-tickets");
      setData(response.data);
    } catch (loadError) {
      setError(describeApiError(loadError, "تعذر تحميل مركز الدعم"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setError(null);
    try {
      const response = await axios.get<TicketDetail>(`/api/admin/support-tickets/${id}`);
      setDetail(response.data);
    } catch (loadError) {
      setError(describeApiError(loadError, "تعذر تحميل تفاصيل التذكرة"));
    }
  }, []);

  useEffect(() => {
    let active = true;
    axios
      .get<SupportData>("/api/admin/support-tickets")
      .then((response) => {
        if (active) setData(response.data);
      })
      .catch((loadError) => {
        if (active) setError(describeApiError(loadError, "تعذر تحميل مركز الدعم"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleTickets = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLocaleLowerCase("ar");
    return data.tickets.filter((ticket) => {
      const matchesStatus = statusFilter === "ALL" || ticket.status === statusFilter;
      const matchesSearch = !query || [ticket.reference, ticket.title, ticket.school?.name ?? ""]
        .some((value) => value.toLocaleLowerCase("ar").includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [data, search, statusFilter]);

  async function selectTicket(id: string) {
    setSelectedId(id);
    setDetail(null);
    setNote("");
    setAccessReason("");
    await loadDetail(id);
  }

  async function createTicket(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await axios.post<{ id: string }>("/api/admin/support-tickets", createForm);
      setShowCreate(false);
      setCreateForm({ schoolId: "", title: "", description: "", category: "", priority: "NORMAL" });
      await loadList();
      await selectTicket(response.data.id);
    } catch (createError) {
      setError(describeApiError(createError, "تعذر إنشاء التذكرة"));
    } finally {
      setBusy(false);
    }
  }

  async function updateTicket(update: Partial<Pick<TicketDetail, "status" | "priority">>) {
    if (!detail) return;
    setBusy(true);
    try {
      await axios.patch(`/api/admin/support-tickets/${detail.id}`, update);
      await Promise.all([loadList(), loadDetail(detail.id)]);
    } catch (updateError) {
      setError(describeApiError(updateError, "تعذر تحديث التذكرة"));
    } finally {
      setBusy(false);
    }
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || note.trim().length < 2) return;
    setBusy(true);
    try {
      await axios.post(`/api/admin/support-tickets/${detail.id}/notes`, { body: note });
      setNote("");
      await Promise.all([loadList(), loadDetail(detail.id)]);
    } catch (noteError) {
      setError(describeApiError(noteError, "تعذر إضافة الملاحظة"));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAttachment(event: React.ChangeEvent<HTMLInputElement>) {
    if (!detail || !event.target.files?.[0]) return;
    const formData = new FormData();
    formData.set("file", event.target.files[0]);
    setBusy(true);
    try {
      await axios.post(`/api/admin/support-tickets/${detail.id}/attachments`, formData);
      await Promise.all([loadList(), loadDetail(detail.id)]);
    } catch (uploadError) {
      setError(describeApiError(uploadError, "تعذر رفع لقطة الشاشة"));
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function startSecureAccess(event: React.FormEvent) {
    event.preventDefault();
    if (!detail?.school || accessReason.trim().length < 10) return;
    setBusy(true);
    try {
      const response = await axios.post<{ id: string }>("/api/admin/support-access", {
        schoolId: detail.school.id,
        ticketId: detail.id,
        reason: accessReason,
        durationMinutes,
      });
      router.push(`/admin/support/${response.data.id}`);
    } catch (accessError) {
      setError(describeApiError(accessError, "تعذر بدء جلسة الدعم"));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">مركز الدعم الفني</h1>
          <p className="mt-1 text-sm text-gray-400">تذاكر الدعم وجلسات التشخيص الآمنة محدودة الوقت</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void loadList()} disabled={loading} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50">
            تحديث
          </button>
          <button type="button" onClick={() => setShowCreate((value) => !value)} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            تذكرة جديدة
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

      {data && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              ["جديدة", data.summary.open, "text-sky-300"],
              ["قيد المعالجة", data.summary.inProgress, "text-indigo-300"],
              ["بانتظار المنشأة", data.summary.waiting, "text-amber-300"],
              ["تم حلها", data.summary.resolved, "text-emerald-300"],
              ["عاجلة مفتوحة", data.summary.urgentOpen, "text-red-300"],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-4">
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="mt-1 text-xs text-gray-500">{label}</div>
              </div>
            ))}
          </section>

          {showCreate && (
            <form onSubmit={createTicket} className="grid grid-cols-1 gap-4 rounded-2xl border border-indigo-500/20 bg-[#1e1e2e] p-5 lg:grid-cols-2">
              <h2 className="text-lg font-semibold text-white lg:col-span-2">إنشاء تذكرة دعم</h2>
              <label className="text-xs text-gray-400">المنشأة
                <select required value={createForm.schoolId} onChange={(event) => setCreateForm((form) => ({ ...form, schoolId: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2.5 text-sm text-white">
                  <option value="">اختاري المنشأة</option>
                  {data.schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-400">الأولوية
                <select value={createForm.priority} onChange={(event) => setCreateForm((form) => ({ ...form, priority: event.target.value as TicketPriority }))} className="mt-1 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2.5 text-sm text-white">
                  {Object.entries(PRIORITY).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-400">العنوان
                <input required minLength={3} maxLength={120} value={createForm.title} onChange={(event) => setCreateForm((form) => ({ ...form, title: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2.5 text-sm text-white" />
              </label>
              <label className="text-xs text-gray-400">التصنيف
                <input value={createForm.category} onChange={(event) => setCreateForm((form) => ({ ...form, category: event.target.value }))} placeholder="مثال: إشعارات، تسجيل دخول" className="mt-1 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2.5 text-sm text-white" />
              </label>
              <label className="text-xs text-gray-400 lg:col-span-2">وصف المشكلة
                <textarea required minLength={3} value={createForm.description} onChange={(event) => setCreateForm((form) => ({ ...form, description: event.target.value }))} rows={3} className="mt-1 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2.5 text-sm text-white" />
              </label>
              <div className="flex justify-end gap-2 lg:col-span-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl px-4 py-2 text-sm text-gray-400">إلغاء</button>
                <button type="submit" disabled={busy} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm text-white disabled:opacity-50">حفظ التذكرة</button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <section className="overflow-hidden rounded-2xl border border-white/5 bg-[#1e1e2e]">
              <div className="border-b border-white/5 p-5">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-60 flex-1 text-xs text-gray-500">بحث
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم التذكرة أو المنشأة أو العنوان" className="mt-1 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-sm text-white" />
                  </label>
                  <label className="text-xs text-gray-500">الحالة
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | TicketStatus)} className="mt-1 rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-sm text-white">
                      <option value="ALL">كل الحالات</option>
                      {Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <div className="divide-y divide-white/5">
                {visibleTickets.map((ticket) => (
                  <button key={ticket.id} type="button" onClick={() => void selectTicket(ticket.id)} className={`w-full p-4 text-right transition hover:bg-white/[0.03] ${selectedId === ticket.id ? "bg-indigo-500/10" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-indigo-300">{ticket.reference}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS[ticket.status].classes}`}>{STATUS[ticket.status].label}</span>
                        </div>
                        <div className="mt-1 font-medium text-white">{ticket.title}</div>
                        <div className="mt-1 text-xs text-gray-500">{ticket.school?.name ?? "منشأة محذوفة"} · {formatDate(ticket.updatedAt)}</div>
                      </div>
                      <div className="text-left">
                        <div className={`text-xs ${PRIORITY[ticket.priority].classes}`}>{PRIORITY[ticket.priority].label}</div>
                        <div className="mt-2 text-[10px] text-gray-600">{ticket._count.notes} ملاحظات · {ticket._count.attachments} مرفقات</div>
                      </div>
                    </div>
                  </button>
                ))}
                {visibleTickets.length === 0 && <div className="p-10 text-center text-sm text-gray-500">لا توجد تذاكر مطابقة.</div>}
              </div>
            </section>

            <section className="rounded-2xl border border-white/5 bg-[#1e1e2e] p-5">
              {!selectedId && <div className="py-20 text-center text-sm text-gray-500">اختاري تذكرة لعرض التفاصيل.</div>}
              {selectedId && !detail && <div className="py-20 text-center text-sm text-gray-500">جاري تحميل التفاصيل...</div>}
              {detail && (
                <div className="space-y-5">
                  <div className="border-b border-white/5 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-indigo-300">{detail.reference}</div>
                        <h2 className="mt-1 text-lg font-semibold text-white">{detail.title}</h2>
                        <div className="mt-1 text-xs text-gray-500">{detail.school?.name ?? "منشأة محذوفة"}</div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] ${STATUS[detail.status].classes}`}>{STATUS[detail.status].label}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-300">{detail.description}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-gray-500">الحالة
                      <select disabled={busy} value={detail.status} onChange={(event) => void updateTicket({ status: event.target.value as TicketStatus })} className="mt-1 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-sm text-white">
                        {Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-gray-500">الأولوية
                      <select disabled={busy} value={detail.priority} onChange={(event) => void updateTicket({ priority: event.target.value as TicketPriority })} className="mt-1 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-sm text-white">
                        {Object.entries(PRIORITY).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                      </select>
                    </label>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-white">ملاحظات الدعم الداخلية</h3>
                    <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                      {detail.notes.map((item) => (
                        <div key={item.id} className="rounded-xl bg-white/[0.03] p-3">
                          <p className="whitespace-pre-wrap text-sm text-gray-300">{item.body}</p>
                          <div className="mt-2 text-[10px] text-gray-600">{item.authorAdmin.email} · {formatDate(item.createdAt)}</div>
                        </div>
                      ))}
                      {detail.notes.length === 0 && <p className="text-xs text-gray-600">لا توجد ملاحظات.</p>}
                    </div>
                    <form onSubmit={addNote} className="mt-3 flex gap-2">
                      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="أضيفي ملاحظة داخلية..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-sm text-white" />
                      <button disabled={busy || note.trim().length < 2} className="rounded-xl bg-white/10 px-3 py-2 text-xs text-white disabled:opacity-40">إضافة</button>
                    </form>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-medium text-white">لقطات الشاشة</h3>
                      <label className="cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">
                        رفع صورة
                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadAttachment(event)} className="hidden" />
                      </label>
                    </div>
                    <div className="mt-2 space-y-2">
                      {detail.attachments.map((attachment) => (
                        <a key={attachment.id} href={attachment.fileUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3 text-xs text-indigo-300 hover:bg-white/[0.05]">
                          <span className="truncate">{attachment.fileName}</span>
                          <span className="text-gray-600">{formatBytes(attachment.sizeBytes)}</span>
                        </a>
                      ))}
                      {detail.attachments.length === 0 && <p className="text-xs text-gray-600">لا توجد مرفقات.</p>}
                    </div>
                  </div>

                  {detail.school && (
                    <form onSubmit={startSecureAccess} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <h3 className="text-sm font-semibold text-emerald-200">جلسة دعم آمنة</h3>
                      <p className="mt-1 text-[11px] leading-5 text-gray-500">قراءة فقط، لا تعرض أسماء الأطفال أو معلوماتهم الصحية، وتنتهي تلقائيًا.</p>
                      <textarea required minLength={10} value={accessReason} onChange={(event) => setAccessReason(event.target.value)} placeholder="سبب الدخول بالتفصيل..." rows={2} className="mt-3 w-full rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-sm text-white" />
                      <div className="mt-2 flex items-center gap-2">
                        <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} className="rounded-xl border border-white/10 bg-[#171722] px-3 py-2 text-xs text-white">
                          <option value={15}>15 دقيقة</option>
                          <option value={30}>30 دقيقة</option>
                          <option value={60}>60 دقيقة</option>
                        </select>
                        <button disabled={busy || accessReason.trim().length < 10} className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">بدء المعاينة الآمنة</button>
                      </div>
                    </form>
                  )}

                  <dl className="grid grid-cols-2 gap-2 border-t border-white/5 pt-4 text-[11px]">
                    <div><dt className="text-gray-600">وقت الإنشاء</dt><dd className="mt-1 text-gray-400">{formatDate(detail.createdAt)}</dd></div>
                    <div><dt className="text-gray-600">أول استجابة</dt><dd className="mt-1 text-gray-400">{formatDate(detail.firstRespondedAt)}</dd></div>
                  </dl>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
