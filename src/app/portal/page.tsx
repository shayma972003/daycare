"use client";

/**
 * The parent portal (tasks 2.32–2.33).
 *
 * Mobile-first and outside `(dashboard)`: it has no sidebar, no nursery
 * chrome, and a completely different audience. Building it inside the staff
 * layout would mean every staff-facing change risked breaking the screen parents
 * see.
 *
 * Signs in with phone number and an emailed code — the same flow as the app,
 * against the same `GuardianAccount`. The token is kept in `sessionStorage`
 * rather than `localStorage`: portals get opened on shared and borrowed phones,
 * and a session that survives closing the tab is a session the next person
 * inherits.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import axios from "axios";
import { formatAst } from "@/lib/datetime";
import { CARE_TYPE_COLORS, CARE_TYPE_LABEL_KEYS } from "@/lib/care-reports";
import { Icon, CARE_TYPE_ICON_NAMES } from "@/components/ui/Icon";
import { ATTENDANCE_STATUS_LABEL_KEYS } from "@/lib/attendance-schedule";
import type { CareReportType } from "@/generated/prisma/enums";
import { useLocale } from "@/lib/i18n-provider";

const TOKEN_KEY = "portal_access_token";

/**
 * The stored token, as an external store.
 *
 * `sessionStorage` cannot be read during render — the server has no such object,
 * so a lazy initialiser returns null there and the token on the client, which is
 * a hydration mismatch. Reading it in an effect and calling `setState` works but
 * costs a second render pass on every load and is what React's
 * `set-state-in-effect` rule exists to discourage.
 *
 * `useSyncExternalStore` is the shape designed for exactly this: a server
 * snapshot of `null`, a client snapshot from storage, and an explicit
 * subscription so `setPortalToken` updates every reader.
 */
const tokenListeners = new Set<() => void>();

function subscribeToken(listener: () => void) {
  tokenListeners.add(listener);
  // Also reacts to another tab signing out, which `storage` events cover.
  window.addEventListener("storage", listener);
  return () => {
    tokenListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

/** Server render has no session storage; the portal starts signed out there. */
function readTokenOnServer(): string | null {
  return null;
}

function setPortalToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
  for (const listener of tokenListeners) listener();
}

interface Report {
  id: string;
  type: CareReportType;
  typeLabel: string;
  summary: string;
  occurredAt: string;
  note: string | null;
  photoUrl: string | null;
}

interface Child {
  id: string;
  name: string;
  avatarUrl: string | null;
  allergies: string | null;
  healthCondition: string | null;
  paymentStatus: string;
  enrollmentEndDate: string | null;
  class: { id: string; name: string } | null;
  todayAttendance: {
    status: keyof typeof ATTENDANCE_STATUS_LABEL_KEYS;
    checkinAt: string | null;
    checkoutAt: string | null;
  } | null;
  todayReports: Report[];
}

interface PortalData {
  guardianName: string | null;
  school: { name: string; logoUrl: string | null; phoneNumber: string | null } | null;
  children: Child[];
  events: { id: string; title: string; startAt: string; allDay: boolean }[];
}

export default function PortalPage() {
  const { t, locale } = useLocale();
  const token = useSyncExternalStore(subscribeToken, readToken, readTokenOnServer);
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (accessToken: string) => {
    try {
      const response = await axios.get<PortalData>("/api/portal/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setData(response.data);
      setError(null);
    } catch {
      // Any failure here means the token is no longer good — expired, revoked,
      // or from a session someone ended. Dropping it returns to sign-in rather
      // than leaving a blank screen with no explanation.
      setPortalToken(null);
      setData(null);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    axios
      .get<PortalData>("/api/portal/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch(() => {
        if (!cancelled) setPortalToken(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function signOut() {
    setPortalToken(null);
    setData(null);
  }

  if (!token) {
    return (
      <PortalSignIn
        onSignedIn={(accessToken) => {
          setPortalToken(accessToken);
          load(accessToken);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      <header className="bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3 sticky top-0 z-10">
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-[#111111] truncate">
            {data?.school?.name ?? t("portal.title")}
          </h1>
          {data?.guardianName && (
            <p className="text-xs text-gray-500 truncate">{t("portal.hello", { name: data.guardianName })}</p>
          )}
        </div>
        <button onClick={signOut} className="text-xs text-gray-500 hover:text-gray-700">
          {t("portal.logout")}
        </button>
      </header>

      <main className="p-4 space-y-4 max-w-2xl mx-auto">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {!data ? (
          <p className="text-sm text-gray-400 py-10 text-center">{t("common.loading")}</p>
        ) : data.children.length === 0 ? (
          <p className="text-sm text-gray-500 py-10 text-center">
            {t("portal.noChildren")}
          </p>
        ) : (
          <>
            {data.children.map((child) => (
              <section key={child.id} className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#F1E8FF] flex items-center justify-center text-[#5B14D1] font-bold shrink-0">
                    {child.name.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-[#111111] truncate">{child.name}</h2>
                    <p className="text-xs text-gray-500">{child.class?.name ?? t("portal.noClass")}</p>
                  </div>
                  {child.todayAttendance && (
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-50 text-gray-700">
                      {t(ATTENDANCE_STATUS_LABEL_KEYS[child.todayAttendance.status])}
                    </span>
                  )}
                </div>

                {child.todayAttendance?.checkinAt && (
                  <p className="text-xs text-gray-500">
                    {t("portal.checkin")}: {" "}
                    {formatAst(new Date(child.todayAttendance.checkinAt), {
                      hour: "2-digit",
                      minute: "2-digit",
                    }, locale)}
                    {child.todayAttendance.checkoutAt && (
                      <>
                        {` · ${t("portal.checkout")}: `}
                        {formatAst(new Date(child.todayAttendance.checkoutAt), {
                          hour: "2-digit",
                          minute: "2-digit",
                        }, locale)}
                      </>
                    )}
                  </p>
                )}

                {(child.allergies || child.healthCondition) && (
                  <div className="text-xs bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-0.5">
                    {child.allergies && <p>{t("portal.allergies")}: {child.allergies}</p>}
                    {child.healthCondition && <p>{t("portal.healthCondition")}: {child.healthCondition}</p>}
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-bold text-[#111111] mb-2">{t("portal.todayReports")}</h3>
                  {child.todayReports.length === 0 ? (
                    <p className="text-xs text-gray-400">{t("portal.noReports")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {child.todayReports.map((report) => (
                        <li key={report.id} className="flex items-start gap-2.5 bg-gray-50 rounded-xl px-3 py-2.5">
                          <Icon
                            name={CARE_TYPE_ICON_NAMES[report.type]}
                            size={18}
                            className={`shrink-0 mt-0.5 ${CARE_TYPE_COLORS[report.type]}`}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#111111]">
                              <span className="text-gray-500">{t(CARE_TYPE_LABEL_KEYS[report.type])}: </span>
                              {report.summary}
                            </p>
                            {report.note && (
                              <p className="text-xs text-gray-600 mt-0.5">{report.note}</p>
                            )}
                            {report.photoUrl && (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={report.photoUrl}
                                alt=""
                                // Wider than the staff thumbnail: this is a parent
                                // being shown a picture of their child, which is
                                // the reason the feature exists.
                                className="mt-2 w-full max-w-[220px] rounded-xl object-cover border border-gray-200"
                              />
                            )}
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {formatAst(new Date(report.occurredAt), {
                                hour: "2-digit",
                                minute: "2-digit",
                              }, locale)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            ))}

            {data.events.length > 0 && (
              <section className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="font-bold text-[#111111] mb-3">{t("portal.upcoming")}</h2>
                <ul className="space-y-2">
                  {data.events.map((event) => (
                    <li key={event.id} className="flex items-center gap-3 text-sm">
                      <span className="text-xs text-gray-400 shrink-0 w-24">
                        {formatAst(new Date(event.startAt), { month: "short", day: "numeric" }, locale)}
                      </span>
                      <span className="text-[#111111]">{event.title}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/**
 * Email and password — the same credentials as the app.
 *
 * Was phone → emailed code. The phone only ever named the account; the code went
 * to the email regardless, because there is no SMS gateway. Guardians now set a
 * password when they redeem their invitation, so there is nothing left for the
 * two-step dance to establish.
 */
function PortalSignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const response = await axios.post<{ accessToken: string }>(
        "/api/mobile/v1/auth/login",
        // `kind` selects which table to search: the same address may belong to a
        // teacher who is also a parent here.
        { email: email.trim().toLowerCase(), password, kind: "guardian" }
      );
      onSignedIn(response.data.accessToken);
    } catch (err) {
      setError(
        axios.isAxiosError(err) && err.response?.status === 401
          ? t("portal.invalidCredentials")
          : t("portal.signInFailed")
      );
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f6fb] flex items-center justify-center p-5">
      <div className="bg-white rounded-2xl shadow-sm p-6 w-full max-w-sm space-y-4">
        <h1 className="font-bold text-[#111111] text-lg">{t("portal.title")}</h1>

        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">{t("portal.email")}</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            dir="ltr"
            placeholder="name@example.com"
            className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">{t("portal.password")}</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            dir="ltr"
            placeholder="••••••••"
            onKeyDown={(e) => {
              if (e.key === "Enter" && email.trim() && password) signIn();
            }}
            className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm"
          />
        </div>

        <button
          onClick={signIn}
          disabled={busy || !email.trim() || !password}
          className="w-full py-3 bg-[#5B14D1] text-white rounded-xl text-sm font-bold hover:bg-[#490EA9] disabled:opacity-60"
        >
          {busy ? "..." : t("portal.signIn")}
        </button>

        <p className="text-xs text-gray-400 leading-relaxed">
          {t("portal.inviteHint")}
        </p>
      </div>
    </div>
  );
}
