"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import * as Tabs from "@radix-ui/react-tabs";

interface School { id: string; name: string }
interface SentMessage {
  id: string;
  subject: string;
  target_type: string;
  sent_at: string | null;
  scheduled_at: string | null;
  recipientCount: number;
  deliveredCount: number;
}
interface AlertRule {
  id: string;
  trigger_type: string;
  threshold_days: number | null;
  message_subject: string;
  message_template: string;
  is_active: boolean;
}

const TEMPLATES = [
  { key: "renewal", label: "تذكير التجديد", subject: "تذكير: اشتراكك ينتهي قريباً", body: "عزيزي <school_name>، نود تذكيرك بأن اشتراكك في خطة <plan_name> ينتهي بتاريخ <renewal_date>. يرجى التجديد لضمان استمرارية الخدمة." },
  { key: "expired", label: "إشعار انتهاء الاشتراك", subject: "انتهى اشتراكك", body: "نعلمك <school_name> بانتهاء اشتراكك. تواصل معنا على الفور لإعادة التفعيل وتجنب انقطاع الخدمة." },
  { key: "welcome", label: "رسالة ترحيب", subject: "مرحباً بك في المنصة", body: "أهلاً وسهلاً <school_name>! يسعدنا انضمامك إلى المنصة. إذا احتجت أي مساعدة فنحن هنا لخدمتك." },
  { key: "maintenance", label: "إشعار صيانة", subject: "إشعار صيانة مجدولة", body: "نود إعلامكم بأنه سيكون هناك توقف مؤقت للصيانة يوم ___. نعتذر عن أي إزعاج." },
  { key: "upgrade", label: "عرض ترقية", subject: "عرض خاص: ترقّ خطتك", body: "عزيزي <school_name>، لدينا عرض حصري لترقية خطتك إلى <plan_name> بسعر مميز. تواصل معنا الآن." },
];

const TRIGGER_LABELS: Record<string, string> = {
  no_login: "عدم تسجيل الدخول",
  renewal_soon: "تجديد قريب",
  renewal_tomorrow: "تجديد غداً",
  expired: "اشتراك منتهٍ",
  plan_limit: "تجاوز الحد",
};

export default function CommunicationsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);

  // Compose form
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [targetType, setTargetType] = useState<"all" | "specific" | "by_status">("all");
  const [selectedSchools, setSelectedSchools] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("active");
  const [scheduledAt, setScheduledAt] = useState("");
  const [sending, setSending] = useState(false);

  // Alert rule editing
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  async function load() {
    const [schoolsRes, msgRes, rulesRes] = await Promise.all([
      axios.get<{ id: string; name: string; email: string | null }[]>("/api/admin/schools"),
      axios.get<SentMessage[]>("/api/admin/messages"),
      axios.get<AlertRule[]>("/api/admin/alert-rules"),
    ]);
    setSchools(schoolsRes.data.map((s) => ({ id: s.id, name: s.name })));
    setSentMessages(msgRes.data);
    setAlertRules(rulesRes.data);
  }

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  function fillTemplate(t: typeof TEMPLATES[0]) {
    setSubject(t.subject);
    setBody(t.body);
  }

  async function sendMessage() {
    setSending(true);
    try {
      await axios.post("/api/admin/messages", {
        subject,
        body,
        target_type: targetType,
        school_ids: targetType === "specific" ? selectedSchools : undefined,
        status_filter: targetType === "by_status" ? statusFilter : undefined,
        scheduled_at: scheduledAt || null,
      });
      setSubject("");
      setBody("");
      setScheduledAt("");
      const res = await axios.get<SentMessage[]>("/api/admin/messages");
      setSentMessages(res.data);
    } finally {
      setSending(false);
    }
  }

  async function saveRule(rule: AlertRule) {
    await axios.put(`/api/admin/alert-rules/${rule.id}`, rule);
    setEditingRule(null);
    const res = await axios.get<AlertRule[]>("/api/admin/alert-rules");
    setAlertRules(res.data);
  }

  async function toggleRule(rule: AlertRule) {
    await axios.put(`/api/admin/alert-rules/${rule.id}`, { is_active: !rule.is_active });
    const res = await axios.get<AlertRule[]>("/api/admin/alert-rules");
    setAlertRules(res.data);
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">جاري التحميل...</div>;

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-white">التواصل</h1>

      <Tabs.Root defaultValue="manual">
        <Tabs.List className="flex gap-1 bg-[#1e1e2e] p-1 rounded-xl w-fit border border-white/5 mb-6">
          <Tabs.Trigger value="manual" className="px-4 py-2 text-sm text-gray-400 rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-all">يدوي</Tabs.Trigger>
          <Tabs.Trigger value="auto" className="px-4 py-2 text-sm text-gray-400 rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-all">تلقائي</Tabs.Trigger>
        </Tabs.List>

        {/* Manual Tab */}
        <Tabs.Content value="manual" className="space-y-6">
          <div className="grid grid-cols-3 gap-6">
            {/* Compose Form */}
            <div className="col-span-2 bg-[#1e1e2e] rounded-2xl border border-white/5 p-6 space-y-4">
              <h2 className="text-white font-semibold">إنشاء رسالة</h2>

              <div>
                <label className="text-gray-400 text-xs block mb-1">الموضوع</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input-admin w-full" placeholder="موضوع الرسالة" />
              </div>

              <div>
                <label className="text-gray-400 text-xs block mb-1">نص الرسالة</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="input-admin w-full resize-none" placeholder="نص الرسالة..." />
                <div className="mt-2 flex flex-wrap gap-2">
                  {["<school_name>", "<renewal_date>", "<plan_name>", "<amount_due>"].map((v) => (
                    <button key={v} onClick={() => setBody((b) => b + v)} className="text-xs bg-indigo-600/20 text-indigo-400 px-2 py-0.5 rounded font-mono hover:bg-indigo-600/40">
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-gray-400 text-xs block mb-1">المستهدفون</label>
                <div className="flex gap-3">
                  {(["all", "specific", "by_status"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTargetType(t)}
                      className={`px-3 py-1.5 text-xs rounded-lg ${targetType === t ? "bg-indigo-600 text-white" : "bg-white/5 text-gray-400 hover:bg-white/10"}`}
                    >
                      {t === "all" ? "جميع المدارس" : t === "specific" ? "مدارس محددة" : "حسب الحالة"}
                    </button>
                  ))}
                </div>

                {targetType === "specific" && (
                  <div className="mt-3 max-h-40 overflow-y-auto bg-[#0f0f1a] rounded-xl border border-white/10 p-2 space-y-1">
                    {schools.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-2 rounded-lg">
                        <input
                          type="checkbox"
                          checked={selectedSchools.includes(s.id)}
                          onChange={(e) => setSelectedSchools(e.target.checked ? [...selectedSchools, s.id] : selectedSchools.filter((x) => x !== s.id))}
                        />
                        <span className="text-white text-sm">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}

                {targetType === "by_status" && (
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-admin mt-2">
                    <option value="active">نشط</option>
                    <option value="suspended">موقوف</option>
                    <option value="expired">منتهٍ</option>
                    <option value="trial">تجريبي</option>
                  </select>
                )}
              </div>

              <div>
                <label className="text-gray-400 text-xs block mb-1">جدولة (اختياري)</label>
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="input-admin" />
              </div>

              <button
                onClick={sendMessage}
                disabled={!subject || !body || sending}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm rounded-xl"
              >
                {sending ? "جاري الإرسال..." : scheduledAt ? "جدولة الرسالة" : "إرسال الآن"}
              </button>
            </div>

            {/* Templates Sidebar */}
            <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-4 space-y-2">
              <h3 className="text-white font-semibold text-sm mb-3">قوالب جاهزة</h3>
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => fillTemplate(t)}
                  className="w-full text-right px-3 py-2.5 bg-white/3 hover:bg-white/8 rounded-xl text-gray-300 text-sm transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sent Messages */}
          <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
            <div className="p-5 border-b border-white/5">
              <h2 className="text-white font-semibold text-sm">الرسائل المُرسلة</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {["الموضوع", "المستهدف", "المستلمون", "الوصول", "التاريخ"].map((h) => (
                    <th key={h} className="px-5 py-3 text-right text-gray-400 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sentMessages.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 text-white">{m.subject}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{m.target_type}</td>
                    <td className="px-5 py-3 text-gray-300">{m.recipientCount}</td>
                    <td className="px-5 py-3 text-gray-300">{m.deliveredCount}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {m.sent_at ? new Date(m.sent_at).toLocaleDateString("ar-SA") : m.scheduled_at ? `مجدولة ${new Date(m.scheduled_at).toLocaleDateString("ar-SA")}` : "—"}
                    </td>
                  </tr>
                ))}
                {sentMessages.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-gray-500">لا توجد رسائل</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        {/* Automated Tab */}
        <Tabs.Content value="auto">
          <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {["الحالة", "النوع", "الشرط", "الموضوع", "إجراءات"].map((h) => (
                    <th key={h} className="px-5 py-3 text-right text-gray-400 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {alertRules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => toggleRule(rule)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${rule.is_active ? "bg-indigo-600" : "bg-white/10"}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${rule.is_active ? "left-5" : "left-0.5"}`} />
                      </button>
                    </td>
                    <td className="px-5 py-3 text-white">{TRIGGER_LABELS[rule.trigger_type] ?? rule.trigger_type}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {rule.threshold_days !== null ? `بعد ${rule.threshold_days} أيام` : "فوري"}
                    </td>
                    <td className="px-5 py-3 text-gray-300 text-xs">
                      {editingRule?.id === rule.id ? (
                        <input
                          value={editingRule.message_subject}
                          onChange={(e) => setEditingRule({ ...editingRule, message_subject: e.target.value })}
                          className="input-admin w-full"
                        />
                      ) : rule.message_subject}
                    </td>
                    <td className="px-5 py-3">
                      {editingRule?.id === rule.id ? (
                        <div className="flex gap-2">
                          <button onClick={() => saveRule(editingRule)} className="text-xs text-emerald-400">حفظ</button>
                          <button onClick={() => setEditingRule(null)} className="text-xs text-gray-400">إلغاء</button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingRule(rule)} className="text-xs text-indigo-400">تعديل</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
