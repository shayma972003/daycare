"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useSession } from "next-auth/react";
import { useLocale, useT } from "@/lib/i18n-provider";
import { deviceHeaders, deviceTimeZone, formatDeviceTime, localDayBounds } from "@/lib/device-date";
import { useDeviceDay } from "@/lib/use-device-day";
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
  eligible_for_attendance?: boolean;
}
interface AttendanceData { students: AttendancePerson[] | null; teachers: AttendancePerson[] | null; classes?: unknown[] }
interface CalendarRow {
  id: string;
  kind: "event" | "activity";
  type?: "LESSON" | "ACTIVITY" | "ANNOUNCEMENT" | "UNIT";
  title?: string | null;
  name?: string | null;
  description?: string | null;
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  classIds?: string[];
  classNames?: string[];
  childrenCount?: number | null;
  target?: {
    kind: "all" | "classes" | "students";
    classNames: string[];
    count: number | null;
  };
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

function ActionLink({ href, label, permission, tone = "purple", ariaLabel }: { href: string; label: string; permission: string; tone?: "purple" | "pink"; ariaLabel?: string }) {
  const toneClass = tone === "pink" ? "border-[#e855b4]/30 text-[#ad347d] hover:bg-[#e855b4]/10" : "border-[#4f00c1]/20 text-[#4f00c1] hover:bg-[#4f00c1]/5";
  return (
    <PermissionGate permission={permission}>
      <Link href={href} aria-label={ariaLabel} className={`inline-flex min-h-10 items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${toneClass}`}>{label}</Link>
    </PermissionGate>
  );
}

function statusLabel(person: AttendancePerson, present: string, absent: string, checkedOut: string) {
  if (!person.today_attendance) return absent;
  if (person.today_attendance.checkin_time && !person.today_attendance.checkout_time) return present;
  return checkedOut;
}

function attendanceCounts(people: AttendancePerson[]) {
  const present = people.filter((person) => Boolean(person.today_attendance?.checkin_time)).length;
  const eligible = people.filter((person) => person.eligible_for_attendance !== false);
  const eligiblePresent = eligible.filter((person) => Boolean(person.today_attendance?.checkin_time)).length;
  return { present, absent: Math.max(eligible.length - eligiblePresent, 0) };
}

function eventTargetLabel(event: CalendarRow, t: ReturnType<typeof useT>, locale: "ar" | "en") {
  const target = event.target;
  const classNames = target?.classNames ?? event.classNames ?? [];
  if (target?.kind === "classes" || (event.classIds?.length ?? 0) > 0) {
    return classNames.length > 0
      ? t("dashboard.eventTargetClasses", { classes: classNames.join(locale === "ar" ? "، " : ", ") })
      : t("dashboard.eventTargetClass");
  }
  const count = target?.kind === "students" ? target.count : event.kind === "activity" ? event.childrenCount : null;
  if (typeof count === "number" && count > 0) return t("dashboard.eventTargetStudents", { count });
  return t("dashboard.eventTargetAll");
}

function eventTypeLabel(event: CalendarRow, t: ReturnType<typeof useT>) {
  const type = event.type ?? (event.kind === "activity" ? "ACTIVITY" : "ANNOUNCEMENT");
  return t(`dashboard.eventType${type}`);
}

function eventTimeLabel(event: CalendarRow, t: ReturnType<typeof useT>, locale: "ar" | "en") {
  if (event.allDay) return t("dashboard.allDay");
  const start = new Date(event.startAt);
  if (Number.isNaN(start.getTime())) return t("dashboard.timeUnavailable");
  const startLabel = formatDeviceTime(start, { hour: "2-digit", minute: "2-digit" }, locale);
  if (!event.endAt) return startLabel;
  const end = new Date(event.endAt);
  if (Number.isNaN(end.getTime())) return startLabel;
  return `${startLabel} – ${formatDeviceTime(end, { hour: "2-digit", minute: "2-digit" }, locale)}`;
}

function AttendanceSummaryCard({
  kind,
  permission,
  resource,
  retry,
  retryLabel,
  t,
}: {
  kind: "students" | "teachers";
  permission: "attendance.students" | "attendance.staff";
  resource: Resource<AttendanceData>;
  retry: () => void;
  retryLabel: string;
  t: ReturnType<typeof useT>;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 p-4" aria-labelledby={`dashboard-${kind}-attendance`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id={`dashboard-${kind}-attendance`} className="text-sm font-semibold text-slate-800">{t(`dashboard.${kind}`)}</h3>
        <ActionLink
          href="/attendance"
          label={t("dashboard.openAttendance")}
          ariaLabel={t(kind === "students" ? "dashboard.openStudentAttendance" : "dashboard.openStaffAttendance")}
          permission={permission}
        />
      </div>
      <ResourceState resource={resource} retry={retry} retryLabel={retryLabel}>
        {(data) => {
          const people = data[kind] ?? [];
          const counts = attendanceCounts(people);
          return people.length === 0 ? (
            <p className="rounded-lg bg-white px-3 py-4 text-sm text-slate-500">{t("dashboard.noPeople")}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2" aria-label={t(`dashboard.${kind}AttendanceSummary`)}>
                <div className="rounded-lg bg-white px-3 py-2"><p className="text-xs text-slate-500">{t("dashboard.presentCount")}</p><p className="mt-1 text-xl font-semibold text-[#4f00c1]">{counts.present}</p></div>
                <div className="rounded-lg bg-white px-3 py-2"><p className="text-xs text-slate-500">{t("dashboard.absentCount")}</p><p className="mt-1 text-xl font-semibold text-[#e855b4]">{counts.absent}</p></div>
              </div>
              <div className="mt-3 max-h-40 space-y-1 overflow-y-auto pe-1">
                {people.slice(0, 8).map((person) => <div key={person.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm"><div className="min-w-0"><p className="truncate font-medium text-slate-800">{person.full_name}</p>{person.class_name && <p className="truncate text-xs text-slate-400">{person.class_name}</p>}</div><span className="shrink-0 text-xs text-slate-600">{statusLabel(person, t("dashboard.present"), t("dashboard.absent"), t("dashboard.checkedOut"))}</span></div>)}
              </div>
            </>
          );
        }}
      </ResourceState>
    </article>
  );
}

export function SchoolDashboard() {
  const t = useT();
  const { locale } = useLocale();
  const deviceDay = useDeviceDay();
  const { data: session } = useSession();
  const { can, status: permissionStatus } = usePermissions();
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
  const canViewCalendar = can("schedule.view");
  const canViewStudentAttendance = can("attendance.students");
  const canViewStaffAttendance = can("attendance.staff");

  useEffect(() => {
    if (permissionStatus !== "ready") return;
    const controller = new AbortController();
    axios.get<TasksData>("/api/dashboard/tasks", { signal: controller.signal, headers: deviceHeaders() }).then((response) => {
      if (!controller.signal.aborted) setTasks({ state: "ready", data: response.data, error: null });
    }).catch((error: unknown) => {
      if (!axios.isCancel(error) && !controller.signal.aborted) setTasks((previous) => ({ ...previous, state: "error", error: describeApiError(error, t("common.error")) }));
    });
    return () => controller.abort();
  }, [tasksRetry, permissionStatus, deviceDay, t]);

  useEffect(() => {
    if (permissionStatus !== "ready" || (!canViewStudentAttendance && !canViewStaffAttendance)) return;
    const controller = new AbortController();
    axios.get<AttendanceData>("/api/attendance/page-data", { signal: controller.signal, headers: deviceHeaders() }).then((response) => {
      if (!controller.signal.aborted) setAttendance({ state: "ready", data: response.data, error: null });
    }).catch((error: unknown) => {
      if (!axios.isCancel(error) && !controller.signal.aborted) setAttendance((previous) => ({ ...previous, state: "error", error: describeApiError(error, t("common.error")) }));
    });
    return () => controller.abort();
  }, [attendanceRetry, canViewStaffAttendance, canViewStudentAttendance, permissionStatus, t]);

  useEffect(() => {
    if (permissionStatus !== "ready" || !canViewCalendar) return;
    const controller = new AbortController();
    const { start: from, end: to } = localDayBounds(new Date(), deviceTimeZone());
    axios.get<CalendarRow[]>(`/api/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { signal: controller.signal, headers: deviceHeaders() }).then((response) => {
      if (!controller.signal.aborted) setEvents({ state: "ready", data: response.data, error: null });
    }).catch((error: unknown) => {
      if (!axios.isCancel(error) && !controller.signal.aborted) setEvents((previous) => ({ ...previous, state: "error", error: describeApiError(error, t("common.error")) }));
    });
    return () => controller.abort();
  }, [canViewCalendar, deviceDay, eventsRetry, permissionStatus, t]);

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

  const today = formatDeviceTime(new Date(), { year: "numeric", month: "long", day: "numeric" }, locale);
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
            const students = data.students ?? [];
            const teachers = data.teachers ?? [];
            const studentPresent = students.filter((person) => Boolean(person.today_attendance?.checkin_time)).length;
            const teacherPresent = teachers.filter((person) => Boolean(person.today_attendance?.checkin_time)).length;
            const studentEligible = students.filter((person) => person.eligible_for_attendance !== false);
            const teacherEligible = teachers.filter((person) => person.eligible_for_attendance !== false);
            const studentAbsent = Math.max(studentEligible.length - studentEligible.filter((person) => Boolean(person.today_attendance?.checkin_time)).length, 0);
            const teacherAbsent = Math.max(teacherEligible.length - teacherEligible.filter((person) => Boolean(person.today_attendance?.checkin_time)).length, 0);
            return <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4 sm:gap-y-0">
              <PermissionGate permission="attendance.students"><SummaryMetric label={t("dashboard.activeStudents")} value={String(studentEligible.length)} detail={t("dashboard.peopleActive")} /></PermissionGate>
              <PermissionGate permission="attendance.students"><SummaryMetric label={t("dashboard.studentAttendance")} value={`${studentPresent} / ${studentAbsent}`} detail={t("dashboard.presentAbsent")} tone="pink" /></PermissionGate>
              <PermissionGate permission="attendance.staff"><SummaryMetric label={t("dashboard.teacherAttendance")} value={`${teacherPresent} / ${teacherAbsent}`} detail={t("dashboard.presentAbsent")} tone="blue" /></PermissionGate>
              <PermissionGate permission="attendance.staff"><SummaryMetric label={t("dashboard.staffCount")} value={String(data.teachers?.length ?? 0)} detail={t("dashboard.peopleActive")} /></PermissionGate>
            </div>;
          }}</ResourceState>
        </section>

        <section aria-labelledby="dashboard-attention" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3"><h2 id="dashboard-attention" className="text-base font-semibold text-slate-900">{t("dashboard.attentionTitle")}</h2><span className="h-2 w-2 rounded-full bg-[#f2aa0a]" aria-hidden="true" /></div>
          <ResourceState resource={tasks} retry={retryTasks} retryLabel={retryLabel}>{(data) => data.tasks.filter((task) => task.count > 0).length === 0 ? <p className="rounded-xl bg-[#f4fbf6] px-4 py-3 text-sm text-[#2d7a4f]">{t("dashboard.allClear")}</p> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.tasks.filter((task) => task.count > 0).map((task) => <Link key={task.key} href={task.href} className="flex min-h-16 items-center gap-3 rounded-xl border border-slate-100 px-4 transition-colors hover:border-[#4f00c1]/30 hover:bg-[#4f00c1]/5"><span className="text-xl font-semibold text-[#4f00c1]">{task.count}</span><span className="text-sm text-slate-700">{t(`todo.${task.key}`, { count: task.count })}</span></Link>)}</div>}</ResourceState>
        </section>

        <section aria-labelledby="dashboard-attendance" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-5"><h2 id="dashboard-attendance" className="text-base font-semibold text-slate-900">{t("dashboard.attendanceTitle")}</h2><p className="mt-1 text-sm text-slate-500">{t("dashboard.attendanceHint")}</p></div>
          <div className="grid gap-4 lg:grid-cols-2"><PermissionGate permission="attendance.students"><AttendanceSummaryCard kind="students" permission="attendance.students" resource={attendance} retry={retryAttendance} retryLabel={retryLabel} t={t} /></PermissionGate><PermissionGate permission="attendance.staff"><AttendanceSummaryCard kind="teachers" permission="attendance.staff" resource={attendance} retry={retryAttendance} retryLabel={retryLabel} t={t} /></PermissionGate></div>
        </section>

        <section aria-labelledby="dashboard-events" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 id="dashboard-events" className="text-base font-semibold text-slate-900">{t("dashboard.todayEventsTitle")}</h2><p className="mt-1 text-sm text-slate-500">{t("dashboard.todayEventsHint")}</p></div><ActionLink href="/calendar" label={t("dashboard.openCalendar")} permission="schedule.view" /></div>
          <ResourceState resource={events} retry={retryEvents} retryLabel={retryLabel}>{(data) => {
            const { start: dayStart, end: dayEnd } = localDayBounds(new Date(), deviceTimeZone());
            const todayEvents = data.filter((event) => {
              const start = new Date(event.startAt);
              const end = event.endAt ? new Date(event.endAt) : start;
              return !Number.isNaN(start.getTime()) && start < dayEnd && (event.endAt ? end >= dayStart : start >= dayStart);
            }).sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
            return todayEvents.length === 0 ? <p className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{t("dashboard.noTodayEvents")}</p> : <div role="list" tabIndex={0} aria-label={t("dashboard.todayEventsTitle")} className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 pe-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4f00c1]" style={{ scrollSnapType: "x proximity" }}>{todayEvents.map((event) => {
              const card = <div className="min-w-[17rem] max-w-[22rem] snap-start rounded-xl border border-slate-100 bg-slate-50/70 p-4 transition-colors hover:border-[#4f00c1]/30 hover:bg-[#4f00c1]/5"><div className="flex items-start justify-between gap-3"><p className="min-w-0 truncate text-sm font-semibold text-slate-800">{event.title ?? event.name ?? t("dashboard.untitledEvent")}</p><span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] text-slate-500">{eventTypeLabel(event, t)}</span></div><p className="mt-3 text-sm font-medium text-[#4f00c1]">{eventTimeLabel(event, t, locale)}</p><p className="mt-1 truncate text-xs text-slate-500">{eventTargetLabel(event, t, locale)}</p></div>;
              return canViewCalendar ? <Link key={`${event.kind}-${event.id}`} href="/calendar" className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4f00c1]" aria-label={`${event.title ?? event.name ?? t("dashboard.untitledEvent")}, ${eventTypeLabel(event, t)}`}>{card}</Link> : <div key={`${event.kind}-${event.id}`}>{card}</div>;
            })}</div>;
          }}</ResourceState>
        </section>

        <section aria-labelledby="dashboard-actions" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><h2 id="dashboard-actions" className="mb-4 text-base font-semibold text-slate-900">{t("dashboard.quickActions")}</h2><div className="flex flex-wrap gap-2"><ActionLink href="/students/new" label={t("dashboard.addStudent")} permission="students.manage" /><ActionLink href="/attendance" label={t("dashboard.recordAttendance")} permission="attendance.students" /><ActionLink href="/calendar?create=1" label={t("dashboard.createEvent")} permission="schedule.manage" /><ActionLink href="/students" label={t("dashboard.sendReminder")} permission="finance.manage" /><ActionLink href="/students" label={t("dashboard.reviewEnrollments")} permission={ENROLLMENT_MANAGE_PERMISSION} /></div></section>

        {canViewLogs && <section aria-labelledby="dashboard-recent" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="dashboard-recent" className="text-base font-semibold text-slate-900">{t("dashboard.recentActivity")}</h2><Link href="/settings/logs" className="text-xs font-medium text-[#4f00c1] hover:underline">{t("dashboard.viewMore")}</Link></div><ResourceState resource={logs} retry={retryLogs} retryLabel={retryLabel}>{(data) => data.length === 0 ? <p className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{t("dashboard.noRecentActivity")}</p> : <div className="space-y-2">{data.map((log) => <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm last:border-0 last:pb-0"><span className="text-slate-700">{log.recipientName}</span><span className="text-xs text-slate-400">{formatDeviceTime(new Date(log.sentAt), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }, locale)}</span></div>)}</div>}</ResourceState></section>}
      </div>
    </div>
  );
}
