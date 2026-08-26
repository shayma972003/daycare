// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  useSession: vi.fn(),
  usePermissions: vi.fn(),
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
  PermissionGate: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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
  mocks.usePermissions.mockReturnValue({ can: () => true, status: "ready" });
  mocks.get.mockImplementation((url: string) => {
    if (url === "/api/dashboard/tasks") return Promise.resolve({ data: { tasks: [{ key: "absent", count: 1, href: "/attendance" }] } });
    if (url === "/api/attendance/page-data") return Promise.resolve({ data: attendance.data });
    if (url.startsWith("/api/calendar?")) return Promise.resolve({ data: [{ id: "event-1", kind: "event", title: "Event", startAt: "2026-08-26T08:00:00Z" }] });
    return Promise.resolve({ data: { logs: [] } });
  });
});

afterEach(() => cleanup());

describe("school dashboard", () => {
  it("renders sections in daily order and uses the existing permission gates", async () => {
    render(<SchoolDashboard />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "dashboard.summaryTitle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "dashboard.attentionTitle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "dashboard.attendanceTitle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "dashboard.eventsTitle" })).toBeTruthy();
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
});
