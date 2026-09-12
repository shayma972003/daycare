// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider } from "@/lib/i18n-provider";
import { AttendanceBoard } from "@/components/attendance/AttendanceBoard";
import { WeeklyAttendanceGrid } from "@/components/attendance/WeeklyAttendanceGrid";
import { WeeklyTeacherAttendanceGrid } from "@/components/attendance/WeeklyTeacherAttendanceGrid";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    isAxiosError: () => false,
    isCancel: (error: unknown) => Boolean((error as { code?: string })?.code === "ERR_CANCELED"),
  },
}));

vi.mock("@/lib/use-permissions", () => ({
  usePermissions: () => ({
    can: () => true,
    status: "ready",
  }),
}));

vi.mock("@/components/auth/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockResolvedValue({ data: { updated: 1 } });
  mocks.get.mockResolvedValue({
    data: {
      students: [
        { id: "student-1", full_name: "Ali", avatar_url: null, class_id: null, class_name: null, period: null, today_attendance: null },
        { id: "student-2", full_name: "Sara", avatar_url: null, class_id: null, class_name: null, period: null, today_attendance: null },
      ],
      teachers: [],
      classes: [],
    },
  });
});

describe("daily attendance search", () => {
  it.each([320, 375, 768, 1024, 1440])(
    "keeps the daily board structurally usable at %s px",
    async (width) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      mocks.get.mockResolvedValue({
        data: {
          students: [{ id: "student-1", full_name: "Ali", avatar_url: null, class_id: "class-1", class_name: "Blue", period: null, today_attendance: null }],
          teachers: [],
          classes: [{ id: "class-1", name: "Blue", period: "MORNING" }],
        },
      });
      const { container } = render(<LocaleProvider initialLocale="en"><AttendanceBoard /></LocaleProvider>);
      await screen.findByText("Ali");
      const board = container.querySelector<HTMLElement>("[data-attendance-board]")!;
      const filter = screen.getByRole("region", { name: "Filter" });
      const options = container.querySelector<HTMLElement>("[data-attendance-class-filter]")!;
      expect(board.className).toContain("flex-col");
      expect(board.className).toContain("lg:flex-row");
      expect(filter.className).toContain("w-full");
      expect(filter.className).toContain("lg:w-72");
      expect(options.className).toContain("grid");
      expect(screen.getByRole("searchbox", { name: "All classes" })).toBeTruthy();
      expect(screen.getByRole("combobox")).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Search" }).className).toContain("w-full");
    }
  );

  it("clears a failed load after the real Retry button succeeds", async () => {
    const user = userEvent.setup();
    mocks.get
      .mockRejectedValueOnce(new Error("synthetic offline"))
      .mockResolvedValueOnce({
        data: {
          students: [{ id: "student-retry", full_name: "Retry Child", avatar_url: null, class_id: null, class_name: null, period: null, today_attendance: null }],
          teachers: [],
          classes: [],
        },
      });
    render(<LocaleProvider initialLocale="en"><AttendanceBoard /></LocaleProvider>);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("Retry Child")).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("shows an overnight open session with a manual checkout action", async () => {
    mocks.get.mockResolvedValue({
      data: {
        students: [{
          id: "student-overnight",
          full_name: "Overnight Child",
          avatar_url: null,
          class_id: null,
          class_name: null,
          period: null,
          today_attendance: null,
          open_attendance: {
            date: "2026-08-27",
            checkin_time: "2026-08-27T22:00:00.000Z",
            checkout_time: null,
          },
        }],
        teachers: [],
        classes: [],
      },
    });
    render(<LocaleProvider initialLocale="en"><AttendanceBoard /></LocaleProvider>);
    await screen.findByText("Overnight Child");
    expect(screen.getByRole("button", { name: /logout/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /login/i })).toBeNull();
    expect(screen.getByText("Not checked out")).toBeTruthy();
  });

  it("filters the displayed group while typing and restores it when cleared", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider initialLocale="en">
        <AttendanceBoard />
      </LocaleProvider>
    );

    await waitFor(() => expect(screen.getByText("Ali")).toBeTruthy());
    const search = screen.getByRole("textbox", { name: "Search" });
    await user.type(search, "Ali");

    expect(screen.getByText("Ali")).toBeTruthy();
    expect(screen.queryByText("Sara")).toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(1);

    await user.clear(search);
    expect(screen.getByText("Sara")).toBeTruthy();
    expect(screen.getByText("Ali")).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("filters the teacher group independently from the student group", async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue({
      data: {
        students: [{ id: "student-1", full_name: "Ali", avatar_url: null, class_id: null, class_name: null, period: null, today_attendance: null }],
        teachers: [{ id: "teacher-1", full_name: "Mona", avatar_url: null, class_id: null, class_name: null, period: null, today_attendance: null }],
        classes: [],
      },
    });
    render(<LocaleProvider initialLocale="en"><AttendanceBoard /></LocaleProvider>);
    await waitFor(() => expect(screen.getByText("Ali")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Teacher" }));
    const search = screen.getByRole("textbox", { name: "Search" });
    await user.type(search, "Mona");
    expect(screen.getByText("Mona")).toBeTruthy();
    expect(screen.queryByText("Ali")).toBeNull();
  });
});

describe("weekly attendance search", () => {
  const studentData = {
    weekStart: "2026-08-23",
    days: [{ date: "2026-08-23", weekday: 0 }],
    rows: [
      { studentId: "student-1", name: "Ali", expectedDays: [0], cells: [{ date: "2026-08-23", weekday: 0, expected: true, status: "PRESENT" as const, statusNote: null, checkinAt: null, checkoutAt: null }], ratio: { attended: 1, expected: 1 } },
      { studentId: "student-2", name: "Sara", expectedDays: [0], cells: [{ date: "2026-08-23", weekday: 0, expected: true, status: "NO_RECORD" as const, statusNote: null, checkinAt: null, checkoutAt: null }], ratio: { attended: 0, expected: 1 } },
    ],
    dayTotals: [{ date: "2026-08-23", weekday: 0, present: 1, expected: 2 }],
    class: null,
  };
  const teacherData = {
    weekStart: "2026-08-23",
    days: [{ date: "2026-08-23", weekday: 0 }],
    rows: [
      { teacherId: "teacher-1", name: "Mona", cells: [{ date: "2026-08-23", status: "PRESENT" as const, checkinAt: null, checkoutAt: null }] },
      { teacherId: "teacher-2", name: "Huda", cells: [{ date: "2026-08-23", status: "NO_RECORD" as const, checkinAt: null, checkoutAt: null }] },
    ],
  };

  it("searches the student week and restores rows when cleared", async () => {
    mocks.get.mockImplementation((url: string) => {
      const search = new URL(url, "https://example.invalid").searchParams.get("search");
      return Promise.resolve({ data: search ? { ...studentData, rows: studentData.rows.filter((row) => row.name.includes(search)) } : studentData });
    });
    const { rerender } = render(<LocaleProvider initialLocale="en"><WeeklyAttendanceGrid /></LocaleProvider>);
    await waitFor(() => expect(screen.getByText("Sara")).toBeTruthy());
    rerender(<LocaleProvider initialLocale="en"><WeeklyAttendanceGrid search="Ali" /></LocaleProvider>);
    await waitFor(() => expect(mocks.get.mock.calls.some(([url]) => String(url).includes("search=Ali"))).toBe(true));
    expect(screen.getByText("Ali")).toBeTruthy();
    expect(screen.queryByText("Sara")).toBeNull();
    rerender(<LocaleProvider initialLocale="en"><WeeklyAttendanceGrid search="" /></LocaleProvider>);
    await waitFor(() => expect(screen.getByText("Sara")).toBeTruthy());
  });

  it("searches the teacher week without changing the student endpoint", async () => {
    mocks.get.mockImplementation((url: string) => {
      const search = new URL(url, "https://example.invalid").searchParams.get("search");
      return Promise.resolve({ data: search ? { ...teacherData, rows: teacherData.rows.filter((row) => row.name.includes(search)) } : teacherData });
    });
    const { rerender } = render(<LocaleProvider initialLocale="en"><WeeklyTeacherAttendanceGrid /></LocaleProvider>);
    await waitFor(() => expect(screen.getByText("Huda")).toBeTruthy());
    rerender(<LocaleProvider initialLocale="en"><WeeklyTeacherAttendanceGrid search="Mona" /></LocaleProvider>);
    await waitFor(() => expect(mocks.get.mock.calls.some(([url]) => String(url).includes("/api/attendance/teachers/week") && String(url).includes("search=Mona"))).toBe(true));
    expect(screen.getByText("Mona")).toBeTruthy();
    expect(screen.queryByText("Huda")).toBeNull();
  });

  it("navigates teacher weeks while preserving search and class filters", async () => {
    const user = userEvent.setup();
    mocks.get.mockImplementation((url: string) => {
      const params = new URL(url, "https://example.invalid").searchParams;
      const start = params.get("start") ?? "2026-08-23";
      return Promise.resolve({ data: { ...teacherData, weekStart: start, rows: [] } });
    });
    render(
      <LocaleProvider initialLocale="en">
        <WeeklyTeacherAttendanceGrid classId="class-1" search="Mona" />
      </LocaleProvider>
    );
    await screen.findByRole("button", { name: "Previous week" });
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(mocks.get.mock.calls.some(([url]) => {
      const params = new URL(String(url), "https://example.invalid").searchParams;
      return params.get("start") === "2026-08-16" &&
        params.get("search") === "Mona" && params.get("classId") === "class-1";
    })).toBe(true));
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(mocks.get.mock.calls.some(([url]) =>
      new URL(String(url), "https://example.invalid").searchParams.get("start") === "2026-08-23"
    )).toBe(true));
  });

  it("keeps physical presence read-only and disables future manual cells", async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue({
      data: {
        weekStart: "2026-08-30",
        days: [
          { date: "2026-08-29", weekday: 6 },
          { date: "2026-08-30", weekday: 0 },
          { date: "2026-08-31", weekday: 1 },
        ],
        rows: [{
          studentId: "student-1",
          name: "Ali",
          expectedDays: [0, 1, 6],
          cells: [
            { date: "2026-08-29", weekday: 6, expected: true, editable: true, status: "PRESENT", statusNote: null, checkinAt: "2026-08-29T07:00:00.000Z", checkoutAt: null },
            { date: "2026-08-30", weekday: 0, expected: true, editable: true, status: "ABSENT", statusNote: null, checkinAt: null, checkoutAt: null },
            { date: "2026-08-31", weekday: 1, expected: true, editable: false, status: "NO_RECORD", statusNote: null, checkinAt: null, checkoutAt: null },
          ],
          ratio: { attended: 1, expected: 3 },
        }],
        dayTotals: [
          { date: "2026-08-29", weekday: 6, present: 1, expected: 1 },
          { date: "2026-08-30", weekday: 0, present: 0, expected: 1 },
          { date: "2026-08-31", weekday: 1, present: 0, expected: 1 },
        ],
        class: null,
      },
    });
    const { container } = render(<LocaleProvider initialLocale="en"><WeeklyAttendanceGrid /></LocaleProvider>);
    await screen.findByText("Ali");
    expect(container.querySelector("[data-physical-attendance]")?.textContent).toContain("Present");
    expect(screen.queryByRole("option", { name: "Present" })).toBeNull();
    const past = screen.getByRole("combobox", { name: "Ali 2026-08-30" });
    const future = screen.getByRole("combobox", { name: "Ali 2026-08-31" });
    expect((future as HTMLSelectElement).disabled).toBe(true);
    await user.selectOptions(past, "LEAVE");
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
      "/api/attendance/students/status",
      { studentIds: ["student-1"], status: "LEAVE", date: "2026-08-30" },
      { headers: { "X-Time-Zone": expect.any(String) } }
    ));
  });
});
