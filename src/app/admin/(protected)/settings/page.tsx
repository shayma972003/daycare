"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";

interface AlertRule {
  id: string;
  trigger_type: string;
  threshold_days: number | null;
  message_subject: string;
  message_template: string;
  is_active: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  no_login: "عدم تسجيل الدخول",
  renewal_soon: "تجديد قريب",
  renewal_tomorrow: "تجديد غداً",
  expired: "اشتراك منتهٍ",
  plan_limit: "تجاوز الحد",
};

export default function AdminSettingsPage() {
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [systemInfo, setSystemInfo] = useState({ totalSchools: 0, totalStudents: 0, version: "0.1.0" });

  // Password form
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    axios.get<AlertRule[]>("/api/admin/alert-rules").then((r) => setAlertRules(r.data));
    axios.get<{ stats: { totalActiveSchools: number; totalStudents: number } }>("/api/admin/overview").then((r) => {
      setSystemInfo((prev) => ({
        ...prev,
        totalSchools: r.data.stats.totalActiveSchools,
        totalStudents: r.data.stats.totalStudents,
      }));
    });
  }, []);

  const [ruleError, setRuleError] = useState<string | null>(null);

  async function saveRule(rule: AlertRule) {
    setRuleError(null);
    try {
      await axios.put(`/api/admin/alert-rules/${rule.id}`, rule);
      setEditingRule(null);
      setAlertRules((await axios.get<AlertRule[]>("/api/admin/alert-rules")).data);
    } catch (err) {
      // Was unguarded: a failed save closed nothing and reported nothing.
      setRuleError(describeApiError(err, "تعذر حفظ القاعدة"));
    }
  }

  async function changePassword() {
    setPwError("");
    setPwSuccess(false);
    if (newPw !== confirmPw) { setPwError("كلمتا المرور غير متطابقتين"); return; }
    if (newPw.length < 8) { setPwError("كلمة المرور يجب أن تكون 8 أحرف على الأقل"); return; }
    try {
      await axios.post("/api/admin/settings/password", { currentPassword: currentPw, newPassword: newPw });
      setPwSuccess(true);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (e: unknown) {
      setPwError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "حدث خطأ");
    }
  }

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-2xl font-bold text-white">الإعدادات</h1>

      {/* Security */}
      <section className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-6 max-w-md space-y-4">
        <h2 className="text-white font-semibold">الأمان — تغيير كلمة المرور</h2>
        {pwError && <div className="text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{pwError}</div>}
        {pwSuccess && <div className="text-emerald-400 text-sm bg-emerald-500/10 rounded-lg px-4 py-2">تم تغيير كلمة المرور بنجاح</div>}
        <div>
          <label className="text-gray-400 text-xs block mb-1">كلمة المرور الحالية</label>
          <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} className="input-admin w-full" />
        </div>
        <div>
          <label className="text-gray-400 text-xs block mb-1">كلمة المرور الجديدة</label>
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="input-admin w-full" />
        </div>
        <div>
          <label className="text-gray-400 text-xs block mb-1">تأكيد كلمة المرور</label>
          <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="input-admin w-full" />
        </div>
        <button onClick={changePassword} disabled={!currentPw || !newPw || !confirmPw} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm rounded-xl">
          حفظ التغييرات
        </button>
      </section>

      {/* Alert Rules */}
      <section>
        <h2 className="text-white font-semibold mb-4">قواعد التنبيهات التلقائية</h2>
        {ruleError && (
          <div
            role="alert"
            className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300"
          >
            {ruleError}
          </div>
        )}
        <div className="bg-[#1e1e2e] rounded-2xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["النوع", "العتبة (أيام)", "الموضوع", "القالب", "مفعّل", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-right text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {alertRules.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-5 py-3 text-white">{TRIGGER_LABELS[rule.trigger_type] ?? rule.trigger_type}</td>
                  {editingRule?.id === rule.id ? (
                    <>
                      <td className="px-5 py-3"><input type="number" value={editingRule.threshold_days ?? ""} onChange={(e) => setEditingRule({ ...editingRule, threshold_days: e.target.value ? Number(e.target.value) : null })} className="input-admin w-16" /></td>
                      <td className="px-5 py-3"><input value={editingRule.message_subject} onChange={(e) => setEditingRule({ ...editingRule, message_subject: e.target.value })} className="input-admin w-full" /></td>
                      <td className="px-5 py-3"><textarea value={editingRule.message_template} onChange={(e) => setEditingRule({ ...editingRule, message_template: e.target.value })} rows={2} className="input-admin w-full resize-none text-xs" /></td>
                      <td className="px-5 py-3"><input type="checkbox" checked={editingRule.is_active} onChange={(e) => setEditingRule({ ...editingRule, is_active: e.target.checked })} /></td>
                      <td className="px-5 py-3 flex gap-2">
                        <button onClick={() => saveRule(editingRule)} className="text-xs text-emerald-400">حفظ</button>
                        <button onClick={() => setEditingRule(null)} className="text-xs text-gray-400">إلغاء</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-5 py-3 text-gray-300">{rule.threshold_days ?? "—"}</td>
                      <td className="px-5 py-3 text-gray-300">{rule.message_subject}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{rule.message_template.substring(0, 50)}...</td>
                      <td className="px-5 py-3">{rule.is_active ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>}</td>
                      <td className="px-5 py-3"><button onClick={() => setEditingRule(rule)} className="text-xs text-indigo-400">تعديل</button></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* System Info */}
      <section className="bg-[#1e1e2e] rounded-2xl border border-white/5 p-6 space-y-3 max-w-sm">
        <h2 className="text-white font-semibold">معلومات النظام</h2>
        <InfoRow label="إجمالي المدارس" value={String(systemInfo.totalSchools)} />
        <InfoRow label="إجمالي الطلاب" value={String(systemInfo.totalStudents)} />
        <InfoRow label="قاعدة البيانات" value="متصل ✓" valueClass="text-emerald-400" />
        <InfoRow label="إصدار التطبيق" value={`v${systemInfo.version}`} />
      </section>
    </div>
  );
}

function InfoRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={valueClass ?? "text-white"}>{value}</span>
    </div>
  );
}
