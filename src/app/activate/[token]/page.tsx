"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { PasswordRules, meetsRequiredRules } from "@/components/ui/PasswordRules";
import { PASSWORD_MIN_MESSAGE } from "@/lib/password-policy";

/**
 * Redeeming an invitation.
 *
 * One page for both kinds of account — a teacher and a parent arrive here the
 * same way and do the same thing. Only the closing line differs, because what
 * they do next differs: staff carry on to the dashboard, parents to the app.
 *
 * Deliberately not translated through `useT`: the recipient has never signed in,
 * so there is no locale cookie to read and no settings screen where they could
 * have chosen one. Arabic is the product's default and this page is three
 * sentences long.
 */
interface Invite {
  kind: "staff" | "guardian";
  name: string;
  email: string;
  schoolName: string;
}

export default function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [invite, setInvite] = useState<Invite | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Checked before the form is drawn: asking someone to choose a password and
  // only then telling them the link expired is the wrong order.
  useEffect(() => {
    let cancelled = false;
    axios
      .get<Invite>(`/api/activate/${encodeURIComponent(token)}`)
      .then((res) => {
        if (!cancelled) setInvite(res.data);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }
    if (!meetsRequiredRules(password)) {
      setError(PASSWORD_MIN_MESSAGE);
      return;
    }

    setSaving(true);
    try {
      await axios.post(`/api/activate/${encodeURIComponent(token)}`, { password });
      setDone(true);
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.error ?? "تعذّر إكمال العملية"
          : "تعذّر إكمال العملية"
      );
      setSaving(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#1a2340] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-16 h-16 bg-white/10 rounded-2xl border-2 border-white/20" />
          <h1 className="text-white text-xl font-bold tracking-wide">نظام إدارة الحضانة</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {checking ? (
            <p className="text-center text-sm text-gray-500 py-6">جارٍ التحقق من الدعوة…</p>
          ) : invalid ? (
            <div className="text-center space-y-4">
              <h2 className="text-lg font-bold text-[#1a2340]">الدعوة غير صالحة</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                قد يكون الرابط منتهي الصلاحية أو مستخدَماً من قبل. اطلبي من الحضانة إعادة إرسال
                الدعوة.
              </p>
              <Link href="/login" className="inline-block text-sm text-[#1a2340] underline">
                تسجيل الدخول
              </Link>
            </div>
          ) : done ? (
            <div className="text-center space-y-4">
              <h2 className="text-lg font-bold text-[#1a2340]">تم تفعيل حسابك</h2>
              {/* The next step is not the same for both, so it is not phrased as
                  if it were. */}
              <p className="text-sm text-gray-500 leading-relaxed">
                {invite?.kind === "guardian"
                  ? "افتحي التطبيق وسجّلي الدخول ببريدك وكلمة المرور التي اخترتِها."
                  : "يمكنك الآن تسجيل الدخول ببريدك وكلمة المرور التي اخترتِها."}
              </p>
              {invite?.kind === "staff" && (
                <Link
                  href="/login"
                  className="inline-block w-full py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all"
                >
                  تسجيل الدخول
                </Link>
              )}
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-[#1a2340] mb-2 text-center">
                مرحباً {invite?.name}
              </h2>
              <p className="text-sm text-gray-500 text-center mb-6 leading-relaxed">
                دعتك {invite?.schoolName || "الحضانة"} لإنشاء حسابك. اختاري كلمة مرور للدخول.
              </p>

              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    البريد الإلكتروني
                  </label>
                  {/* Shown, not editable: it is the identity the invitation was
                      issued against, and changing it here would mean anyone with
                      the link could point the account elsewhere. */}
                  <input
                    type="email"
                    value={invite?.email ?? ""}
                    readOnly
                    dir="ltr"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    كلمة المرور
                  </label>
                  <div className="relative">
                    <input
                      type={show ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      dir="ltr"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm transition-all pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium"
                    >
                      {show ? "إخفاء" : "إظهار"}
                    </button>
                  </div>
                  <PasswordRules value={password} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    تأكيد كلمة المرور
                  </label>
                  <input
                    type={show ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    placeholder="••••••••"
                    dir="ltr"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] text-sm transition-all"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60"
                >
                  {saving ? "جارٍ الحفظ…" : "تعيين كلمة المرور"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
