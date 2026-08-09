"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";

/**
 * Guardian accounts, where the nursery can see them.
 *
 * There was no screen for this at all: `/api/guardian-accounts` existed, worked,
 * and nothing in the product called it — so no parent could be invited, and half
 * the app had no users. This is that screen.
 *
 * It sits beside the staff table rather than inside each child's profile because
 * the question it answers is about people, not children: "who can see their
 * child's day, and who is still waiting to be let in". A guardian with three
 * children would otherwise appear three times, each with the same account.
 */
interface GuardianRow {
  guardianId: string;
  name: string;
  email: string | null;
  phone: string | null;
  children: { id: string; name: string }[];
  account: {
    id: string;
    email: string;
    status: "none" | "invited" | "expired" | "active" | "disabled";
    lastLoginAt: string | null;
  } | null;
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  active: { text: "مفعَّل", className: "text-emerald-600" },
  invited: { text: "بانتظار قبول الدعوة", className: "text-amber-600" },
  expired: { text: "انتهت صلاحية الدعوة", className: "text-orange-600" },
  disabled: { text: "معطَّل", className: "text-red-500" },
  none: { text: "بلا حساب", className: "text-gray-400" },
};

export function GuardianAccounts() {
  const [rows, setRows] = useState<GuardianRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** Set when this account may not read guardians at all — see below. */
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get<GuardianRow[]>("/api/guardian-accounts");
      setRows(res.data);
      setError(null);
    } catch (err) {
      /**
       * Hidden rather than shown as an error on a 403.
       *
       * Managing staff logins and reading guardian records are separate
       * permissions, and an accountant who can do the first may hold neither.
       * A red box telling them about a section they were never meant to see is
       * worse than the section simply not being there.
       */
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setForbidden(true);
      } else {
        setError(describeApiError(err, "تعذّر تحميل حسابات أولياء الأمور"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function invite(row: GuardianRow) {
    setError(null);
    setNotice(null);
    setBusyId(row.guardianId);
    try {
      const res = await axios.post<{ invitationSent: boolean }>("/api/guardian-accounts", {
        guardianId: row.guardianId,
      });
      // The same POST creates and re-invites: it upserts and refreshes the
      // token, so there is no second endpoint to keep in step with this one.
      setNotice(
        res.data.invitationSent
          ? `أُرسلت الدعوة إلى ${row.account?.email ?? row.email}`
          : "أُنشئت الدعوة لكن تعذّر إرسال البريد — تحقّقي من إعدادات البريد"
      );
      await load();
    } catch (err) {
      setError(describeApiError(err, "تعذّر إرسال الدعوة"));
    } finally {
      setBusyId(null);
    }
  }

  if (forbidden) return null;

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold text-[#111111]">حسابات أولياء الأمور</h2>
      </div>
      <p className="text-xs text-gray-400 mb-4 leading-relaxed">
        الدعوة تصل على البريد، ومنها يعيّن ولي الأمر كلمة مروره. بعدها يدخل التطبيق بالبريد
        وكلمة المرور.
      </p>

      {error && (
        <div role="alert" className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 py-4">جارٍ التحميل…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">لا يوجد أولياء أمور مسجّلون بعد.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                {["الاسم", "البريد", "الأطفال", "الحالة", ""].map((header) => (
                  <th key={header} className="px-3 py-2 text-right font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => {
                const status = row.account?.status ?? "none";
                const email = row.account?.email ?? row.email;
                return (
                  <tr key={row.guardianId}>
                    <td className="px-3 py-3 text-[#111111]">{row.name}</td>
                    <td className="px-3 py-3 text-gray-600" dir="ltr">
                      {email ?? <span className="text-gray-300" dir="rtl">لا يوجد بريد</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-600">
                      {row.children.map((child) => child.name).join("، ") || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span className={STATUS_LABEL[status].className}>
                        {STATUS_LABEL[status].text}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {status === "disabled" ? null : !email ? (
                        // Refused before it is attempted: the invitation is an
                        // email, so there is nowhere to send it. Saying so here
                        // beats a 422 after the click.
                        <span className="text-xs text-gray-400">أضيفي بريداً أولاً</span>
                      ) : (
                        <button
                          onClick={() => invite(row)}
                          disabled={busyId === row.guardianId}
                          className="text-xs text-[#2F96A6] hover:underline disabled:opacity-50"
                        >
                          {busyId === row.guardianId
                            ? "جارٍ الإرسال…"
                            : status === "none"
                              ? "إرسال دعوة"
                              : status === "active"
                                ? "إعادة إرسال"
                                : "إعادة إرسال الدعوة"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
