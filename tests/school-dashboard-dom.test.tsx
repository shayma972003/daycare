// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  useSession: vi.fn(),
  usePermissions: vi.fn(),
  allowedPermissions: new Set<string>(),
  translate: (key: string, vars?: Record<string, string | number>) => vars?.name ? `${key}:${vars.name}` : key,
}));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    isCancel: (error: unknown) => Boolean((error as { __cancel?: boolean })?.__cancel),
  },
}));
vi.mock("next-auth/react", () => ({ useSession: mocks.useSession }));
vi.mock("@/lib/i18n-provider", () => ({
  useLocale: () => ({ locale: "en", dir: "ltr" }),
  useT: () => mocks.translate,
}));
vi.mock("@/lib/use-permissions", () => ({
  usePermissions: mocks.usePermissions,
}));
vi.mock("@/components/auth/PermissionGate", () => ({
  PermissionGate: ({ children, permission }: { children?: React.ReactNode; permission?: string }) => !permission || mocks.allowedPermissions.has(permission) ? <>{children}</> : null,
}));
vi.mock("@/components/ui/DataLoadState", () => ({
  DataErrorState: ({ message, onRetry }: { message: string; onRetry: () => void }) => <div role="alert"><span>{message}</span><button onClick={onRetry}>retry</button></div>,
}));
vi.mock("@/lib/api-error", () => ({ describeApiError: () => "request failed" }));

import { SchoolDashboard } from "@/components/dashboard/SchoolDashboard";

const attendance = {
  data: {
    students: [{ id: "student-1", full_name: "A", class_name: "Blue", today_attendance: { checkin_time: "2026-08-26T06:00:00Z", checkout_time: null } }],
    teachers: [{ id: "teacher-1", full_name: "T", class_name: null, today_attendance: null }],
  },
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.useSession.mockReturnValue({ data: { user: { name: "Manager", schoolName: "School" } }, status: "authenticated" });
  mocks.allowedPermissions = new Set(["settings.manage", "schedule.view", "students.manage", "attendance.students", "attendance.staff", "schedule.manage", "finance.manage", "students.guardians", "enrollment.manage"]);
  mocks.usePermissions.mockReturnValue({ can: (permission: string) => mocks.allowedPermissions.has(permission), status: "ready" });
  mocks.get.mockImplementation((url: string) => {
    if (url === "/api/dashboard/tasks") return Promise.resolve({ data: { tasks: [{ key: "absent", count: 1, href: "/attendance" }] } });
    if (url === "/api/attendance/page-data") return Promise.resolve({ data: attendance.data });
    if (url.startsWith("/api/calendar?")) return Promise.resolve({ data: [{ id: "event-1", kind: "event", title: "Event", startAt: "2026-08-26T08:00:00Z" }] });
    return Promise.resolve({ data: { logs: [] } });
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("school dashboard", () => {
  it("renders sections in daily order and uses the existing permission gates", async () => {
    render(<SchoolDashboard />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "dashboard.summaryTitle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "dashboard.attentionTitle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "dashboard.attendanceTitle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "dashboard.todayEventsTitle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "dashboard.quickActions" })).toBeTruthy();
    expect(screen.getByText("dashboard.greeting:Manager")).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(4);
  });

  it("keeps error separate from an empty state and exposes retry", async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === "/api/dashboard/tasks") return Promise.reject(new Error("failed"));
      if (url === "/api/attendance/page-data") return Promise.resolve({ data: attendance.data });
      if (url.startsWith("/api/calendar?")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { logs: [] } });
    });
    render(<SchoolDashboard />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("dashboard.allClear")).toBeNull();
    await act(async () => { screen.getByRole("alert").querySelector("button")?.click(); await Promise.resolve(); });
    expect(mocks.get.mock.calls.filter(([url]) => url === "/api/dashboard/tasks")).toHaveLength(2);
  });

  it("aborts every in-flight section request on unmount", () => {
    const signals: AbortSignal[] = [];
    mocks.get.mockImplementation((_url: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      return new Promise(() => {});
    });
    const view = render(<SchoolDashboard />);
    view.unmount();
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("shows only today's sorted calendar entries with class and student targets", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-26T08:00:00.000Z") });
    mocks.get.mockImplementation((url: string) => {
      if (url === "/api/dashboard/tasks") return Promise.resolve({ data: { tasks: [] } });
      if (url === "/api/attendance/page-data") return Promise.resolve({ data: attendance.data });
      if (url.startsWith("/api/calendar?")) return Promise.resolve({ data: [
        { id: "tomorrow", kind: "event", type: "UNIT", title: "Tomorrow", startAt: "2026-08-27T08:00:00Z" },
        { id: "class-event", kind: "event", type: "LESSON", title: "Class lesson", startAt: "2026-08-26T10:00:00Z", endAt: "2026-08-26T11:00:00Z", classIds: ["class-1"], classNames: ["Blue"], target: { kind: "classes", classNames: ["Blue"], count: null } },
        { id: "yesterday", kind: "event", type: "ANNOUNCEMENT", title: "Yesterday", startAt: "2026-08-25T08:00:00Z" },
        { id: "students-event", kind: "activity", type: "ACTIVITY", title: "Small group", startAt: "2026-08-26T08:00:00Z", endAt: "2026-08-26T09:00:00Z", target: { kind: "students", classNames: [], count: 3 } },
      ] });
      return Promise.resolve({ data: { logs: [] } });
    });

    render(<SchoolDashboard />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Class lesson")).toBeTruthy();
    expect(screen.getByText("Blue")).toBeTruthy();
    expect(screen.getByText("dashboard.eventTargetStudents")).toBeTruthy();
    expect(screen.queryByText("Yesterday")).toBeNull();
    expect(screen.queryByText("Tomorrow")).toBeNull();
    expect(screen.queryByText("dashboard.pastActivities")).toBeNull();
    expect(screen.getByRole("list", { name: "dashboard.todayEventsTitle" }).classList.contains("overflow-x-auto")).toBe(true);
  });

  it("shows explicit present and absent totals for both attendance cards", async () => {
    render(<SchoolDashboard />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getAllByText("dashboard.presentCount")).toHaveLength(2);
    expect(screen.getAllByText("dashboard.absentCount")).toHaveLength(2);
    expect(screen.queryByText(/expected/i)).toBeNull();
  });

  it("counts a historical check-in after a later subscription/status change", async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === "/api/dashboard/tasks") return Promise.resolve({ data: { tasks: [] } });
      if (url === "/api/attendance/page-data") return Promise.resolve({ data: {
        students: [
          { id: "historical", full_name: "Historical", class_name: null, eligible_for_attendance: false, today_attendance: { checkin_time: "2026-08-26T06:00:00Z", checkout_time: null } },
          { id: "eligible", full_name: "Eligible", class_name: null, eligible_for_attendance: true, today_attendance: null },
        ],
        teachers: [],
      } });
      if (url.startsWith("/api/calendar?")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { logs: [] } });
    });
    render(<SchoolDashboard />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("dashboard.activeStudents").parentElement?.textContent).toContain("1");
    expect(screen.getByLabelText("dashboard.studentsAttendanceSummary").textContent).toContain("1");
    expect(screen.getByLabelText("dashboard.studentsAttendanceSummary").textContent).toContain("dashboard.absentCount");
  });

  it("gates student and staff attendance actions independently", async () => {
    mocks.allowedPermissions = new Set(["attendance.students"]);
    mocks.usePermissions.mockReturnValue({ can: (permission: string) => mocks.allowedPermissions.has(permission), status: "ready" });
    render(<SchoolDashboard />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("link", { name: "dashboard.openStudentAttendance" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "dashboard.openStaffAttendance" })).toBeNull();
    cleanup();

    mocks.allowedPermissions = new Set(["attendance.staff"]);
    mocks.usePermissions.mockReturnValue({ can: (permission: string) => mocks.allowedPermissions.has(permission), status: "ready" });
    render(<SchoolDashboard />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("link", { name: "dashboard.openStudentAttendance" })).toBeNull();
    expect(screen.getByRole("link", { name: "dashboard.openStaffAttendance" })).toBeTruthy();
  });
});
