"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useSession } from "next-auth/react";
import { useLocale, useT } from "@/lib/i18n-provider";
import { astDayStart, formatAst } from "@/lib/datetime";
import { usePermissions } from "@/lib/use-permissions";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { DataErrorState } from "@/components/ui/DataLoadState";
import { describeApiError } from "@/lib/api-error";
import { ENROLLMENT_MANAGE_PERMISSION } from "@/lib/enrollment-access";
import type { ReactNode } from "react";

type LoadState = "loading" | "refreshing" | "ready" | "error";

interface DashboardTask { key: string; count: number; href: string }
interface TasksData { tasks: DashboardTask[] }
interface AttendancePerson {
  id: string;
  full_name: string;
  class_name: string | null;
  today_attendance: { checkin_time: string | null; checkout_time: string | null } | null;
}
interface AttendanceData { students: AttendancePerson[]; teachers: AttendancePerson[] }
interface CalendarRow {
  id: string;
  kind: "event" | "activity";
  title?: string;
  name?: string;
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  type?: string;
}
interface NotificationLog { id: string; recipientName: string; type: string; status: string; sentAt: string }
interface Resource<T> { state: LoadState; data: T | null; error: string | null }

const initialResource = <T,>(): Resource<T> => ({ state: "loading", data: null, error: null });

function ResourceState<T>({ resource, retry, retryLabel, children }: {
  resource: Resource<T>;
  retry: () => void;
  retryLabel: string;
  children: (data: T) => ReactNode;
}) {
  if (!resource.data && resource.state === "loading") {
    return <div className="h-20 animate-pulse rounded-xl bg-slate-100" aria-label={retryLabel} />;
  }
  if (!resource.data && resource.state === "error") {
    return <DataErrorState message={resource.error ?? retryLabel} retryLabel={retryLabel} onRetry={retry} />;
  }
  return (
    <>
      {resource.state === "refreshing" && <p role="status" className="mb-3 text-xs text-slate-500">{retryLabel}</p>}
      {resource.data ? children(resource.data) : null}
      {resource.state === "error" && resource.data && <DataErrorState message={resource.error ?? retryLabel} retryLabel={retryLabel} onRetry={retry} />}
    </>
  );
}

function SummaryMetric({ label, value, detail, tone = "purple" }: { label: string; value: string; detail?: string; tone?: "purple" | "pink" | "blue" }) {
  const toneClass = { purple: "text-[#4f00c1]", pink: "text-[#e855b4]", blue: "text-[#0eb0ff]" }[tone];
  return (
    <div className="min-w-0 border-s border-slate-100 px-4 first:border-s-0 sm:px-5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

function ActionLink({ href, label, permission, tone = "purple" }: { href: string; label: string; permission: string; tone?: "purple" | "pink" }) {
  const toneClass = tone === "pink" ? "border-[#e855b4]/30 text-[#ad347d] hover:bg-[#e855b4]/10" : "border-[#4f00c1]/20 text-[#4f00c1] hover:bg-[#4f00c1]/5";
  return (
    <PermissionGate permission={permission}>
      <Link href={href} className={`inline-flex min-h-10 items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${toneClass}`}>{label}</Link>
    </PermissionGate>
  );
}

function statusLabel(person: AttendancePerson, present: string, absent: string, checkedOut: string) {
  if (!person.today_attendance) return absent;
  if (person.today_attendance.checkin_time && !person.today_attendance.checkout_time) return present;
  return checkedOut;
}

export function SchoolDashboard() {
  const t = useT();
  const { locale } = useLocale();
  const { data: session } = useSession();
  const { can } = usePermissions();
  const schoolName = (session?.user as { schoolName?: string } | undefined)?.schoolName ?? t("app.name");
  const displayName = session?.user?.name || schoolName;
  const [tasks, setTasks] = useState<Resource<TasksData>>(initialResource);
  const [attendance, setAttendance] = useState<Resource<AttendanceData>>(initialResource);
  const [events, setEvents] = useState<Resource<CalendarRow[]>>(initialResource);
  const [logs, setLogs] = useState<Resource<NotificationLog[]>>(initialResource);
  const [tasksRetry, setTasksRetry] = useState(0);
  const [attendanceRetry, setAttendanceRetry] = useState(0);
  const [eventsRetry, setEventsRetry] = useState(0);
  const [logsRetry, setLogsRetry] = useState(0);
  const canViewLogs = can("settings.manage");

  useEffect(() => {
    const controller = new AbortController();
    axios.get<TasksData>("/api/dashboard/tasks", { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) setTasks({ state: "ready", data: response.data, error: null });
    }).catch((error: unknown) => {
      if (!axios.isCancel(error) && !controller.signal.aborted) setTasks((previous) => ({ ...previous, state: "error", error: describeApiError(error, t("common.error")) }));
    });
    return () => controller.abort();
  }, [tasksRetry, t]);

  useEffect(() => {
    const controller = new AbortController();
    axios.get<AttendanceData>("/api/attendance/page-data", { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) setAttendance({ state: "ready", data: response.data, error: null });
    }).catch((error: unknown) => {
      if (!axios.isCancel(error) && !controller.signal.aborted) setAttendance((previous) => ({ ...previous, state: "error", error: describeApiError(error, t("common.error")) }));
    });
    return () => controller.abort();
  }, [attendanceRetry, t]);

  useEffect(() => {
    const controller = new AbortController();
    const todayStart = astDayStart();
    const riyadhDay = new Date(todayStart.getTime() + 3 * 60 * 60 * 1000).getUTCDay();
    const from = new Date(todayStart.getTime() - riyadhDay * 24 * 60 * 60 * 1000);
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    axios.get<CalendarRow[]>(`/api/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) setEvents({ state: "ready", data: response.data, error: null });
    }).catch((error: unknown) => {
      if (!axios.isCancel(error) && !controller.signal.aborted) setEvents((previous) => ({ ...previous, state: "error", error: describeApiError(error, t("common.error")) }));
    });
    return () => controller.abort();
  }, [eventsRetry, t]);

  useEffect(() => {
    if (!canViewLogs) return;
    const controller = new AbortController();
    axios.get<{ logs: NotificationLog[] }>("/api/notifications?source=activity&skip=0&take=5", { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) setLogs({ state: "ready", data: response.data.logs, error: null });
    }).catch((error: unknown) => {
      if (!axios.isCancel(error) && !controller.signal.aborted) setLogs((previous) => ({ ...previous, state: "error", error: describeApiError(error, t("common.error")) }));
    });
    return () => controller.abort();
  }, [canViewLogs, logsRetry, t]);

  const today = formatAst(new Date(), { year: "numeric", month: "long", day: "numeric" }, locale);
  const retryLabel = t("common.retry");
  const retryTasks = () => { setTasks((previous) => ({ ...previous, state: previous.data ? "refreshing" : "loading", error: null })); setTasksRetry((value) => value + 1); };
  const retryAttendance = () => { setAttendance((previous) => ({ ...previous, state: previous.data ? "refreshing" : "loading", error: null })); setAttendanceRetry((value) => value + 1); };
  const retryEvents = () => { setEvents((previous) => ({ ...previous, state: previous.data ? "refreshing" : "loading", error: null })); setEventsRetry((value) => value + 1); };
  const retryLogs = () => { setLogs((previous) => ({ ...previous, state: previous.data ? "refreshing" : "loading", error: null })); setLogsRetry((value) => value + 1); };

  return (
    <div className="min-h-screen bg-[#f8f8fb]">
      <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[#4f00c1]">{t("dashboard.eyebrow")}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{t("dashboard.greeting", { name: displayName })}</h1>
            <p className="mt-2 text-sm text-slate-500">{today} · {schoolName}</p>
          </div>
          <p className="text-sm text-slate-500">{t("dashboard.todayHint")}</p>
        </header>

        <section aria-labelledby="dashboard-summary" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3"><h2 id="dashboard-summary" className="text-base font-semibold text-slate-900">{t("dashboard.summaryTitle")}</h2><span className="text-xs text-slate-400">{today}</span></div>
          <ResourceState resource={attendance} retry={retryAttendance} retryLabel={retryLabel}>{(data) => {
            const studentPresent = data.students.filter((person) => Boolean(person.today_attendance?.checkin_time)).length;
            const teacherPresent = data.teachers.filter((person) => Boolean(person.today_attendance?.checkin_time)).length;
            const studentAbsent = Math.max(data.students.length - studentPresent, 0);
            const teacherAbsent = Math.max(data.teachers.length - teacherPresent, 0);
            return <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4 sm:gap-y-0"><SummaryMetric label={t("dashboard.activeStudents")} value={String(data.students.length)} detail={t("dashboard.peopleActive")} /><SummaryMetric label={t("dashboard.studentAttendance")} value={`${studentPresent} / ${studentAbsent}`} detail={t("dashboard.presentAbsent")} tone="pink" /><SummaryMetric label={t("dashboard.teacherAttendance")} value={`${teacherPresent} / ${teacherAbsent}`} detail={t("dashboard.presentAbsent")} tone="blue" /><SummaryMetric label={t("dashboard.staffCount")} value={String(data.teachers.length)} detail={t("dashboard.peopleActive")} /></div>;
          }}</ResourceState>
        </section>

        <section aria-labelledby="dashboard-attention" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3"><h2 id="dashboard-attention" className="text-base font-semibold text-slate-900">{t("dashboard.attentionTitle")}</h2><span className="h-2 w-2 rounded-full bg-[#f2aa0a]" aria-hidden="true" /></div>
          <ResourceState resource={tasks} retry={retryTasks} retryLabel={retryLabel}>{(data) => data.tasks.filter((task) => task.count > 0).length === 0 ? <p className="rounded-xl bg-[#f4fbf6] px-4 py-3 text-sm text-[#2d7a4f]">{t("dashboard.allClear")}</p> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.tasks.filter((task) => task.count > 0).map((task) => <Link key={task.key} href={task.href} className="flex min-h-16 items-center gap-3 rounded-xl border border-slate-100 px-4 transition-colors hover:border-[#4f00c1]/30 hover:bg-[#4f00c1]/5"><span className="text-xl font-semibold text-[#4f00c1]">{task.count}</span><span className="text-sm text-slate-700">{t(`todo.${task.key}`, { count: task.count })}</span></Link>)}</div>}</ResourceState>
        </section>

        <section aria-labelledby="dashboard-attendance" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-5"><h2 id="dashboard-attendance" className="text-base font-semibold text-slate-900">{t("dashboard.attendanceTitle")}</h2><p className="mt-1 text-sm text-slate-500">{t("dashboard.attendanceHint")}</p></div>
          <ResourceState resource={attendance} retry={retryAttendance} retryLabel={retryLabel}>{(data) => <div className="grid gap-6 lg:grid-cols-2">{([["students", data.students, "#4f00c1"], ["teachers", data.teachers, "#e855b4"]] as const).map(([kind, people, color]) => <div key={kind} className="min-w-0"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-800">{t(`dashboard.${kind}`)}</h3><span className="text-xs text-slate-500">{people.filter((person) => person.today_attendance?.checkin_time).length}/{people.length}</span></div>{people.length === 0 ? <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">{t("dashboard.noPeople")}</p> : <div className="max-h-52 space-y-1 overflow-y-auto pe-1">{people.slice(0, 8).map((person) => <div key={person.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><div className="min-w-0"><p className="truncate font-medium text-slate-800">{person.full_name}</p>{person.class_name && <p className="truncate text-xs text-slate-400">{person.class_name}</p>}</div><span className="shrink-0 text-xs" style={{ color }}>{statusLabel(person, t("dashboard.present"), t("dashboard.absent"), t("dashboard.checkedOut"))}</span></div>)}</div>}</div>)}</div>}</ResourceState>
        </section>

        <section aria-labelledby="dashboard-events" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 id="dashboard-events" className="text-base font-semibold text-slate-900">{t("dashboard.eventsTitle")}</h2><p className="mt-1 text-sm text-slate-500">{t("dashboard.eventsHint")}</p></div><ActionLink href="/calendar" label={t("dashboard.openCalendar")} permission="schedule.view" /></div>
          <ResourceState resource={events} retry={retryEvents} retryLabel={retryLabel}>{(data) => data.length === 0 ? <p className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{t("dashboard.noEvents")}</p> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.slice(0, 6).map((event) => <Link key={`${event.kind}-${event.id}`} href="/calendar" className="rounded-xl border border-slate-100 p-3 transition-colors hover:border-[#4f00c1]/30 hover:bg-[#4f00c1]/5"><p className="truncate text-sm font-medium text-slate-800">{event.title ?? event.name ?? t("dashboard.untitledEvent")}</p><p className="mt-1 text-xs text-slate-500">{formatAst(new Date(event.startAt), { weekday: "short", hour: "2-digit", minute: "2-digit" }, locale)}</p></Link>)}</div>}</ResourceState>
        </section>

        <section aria-labelledby="dashboard-actions" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><h2 id="dashboard-actions" className="mb-4 text-base font-semibold text-slate-900">{t("dashboard.quickActions")}</h2><div className="flex flex-wrap gap-2"><ActionLink href="/students/new" label={t("dashboard.addStudent")} permission="students.manage" /><ActionLink href="/attendance" label={t("dashboard.recordAttendance")} permission="attendance.students" /><ActionLink href="/calendar?create=1" label={t("dashboard.createEvent")} permission="schedule.manage" /><ActionLink href="/students" label={t("dashboard.sendReminder")} permission="finance.manage" /><ActionLink href="/students" label={t("dashboard.reviewEnrollments")} permission={ENROLLMENT_MANAGE_PERMISSION} /></div></section>

        {canViewLogs && <section aria-labelledby="dashboard-recent" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="dashboard-recent" className="text-base font-semibold text-slate-900">{t("dashboard.recentActivity")}</h2><Link href="/settings/logs" className="text-xs font-medium text-[#4f00c1] hover:underline">{t("dashboard.viewMore")}</Link></div><ResourceState resource={logs} retry={retryLogs} retryLabel={retryLabel}>{(data) => data.length === 0 ? <p className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{t("dashboard.noRecentActivity")}</p> : <div className="space-y-2">{data.map((log) => <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm last:border-0 last:pb-0"><span className="text-slate-700">{log.recipientName}</span><span className="text-xs text-slate-400">{formatAst(new Date(log.sentAt), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }, locale)}</span></div>)}</div>}</ResourceState></section>}
      </div>
    </div>
  );
}
