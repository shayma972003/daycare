// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CalendarEventType, CareReportType } from "@/generated/prisma/enums";
import { LocaleProvider } from "@/lib/i18n-provider";
import { CalendarEventModal } from "@/components/calendar/CalendarEventModal";
import { CareReportModal } from "@/components/care/CareReportModal";
import { ShiftsPanel } from "@/components/teachers/ShiftsPanel";

const axiosMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    ...axiosMocks,
    isAxiosError: () => false,
  },
}));

vi.mock("@/components/auth/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/use-permissions", () => ({
  usePermissions: () => ({ can: (permission: string) => permission === "schedule.manage" }),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  axiosMocks.get.mockImplementation((url: string) => {
    if (url.startsWith("/api/academic-stages")) {
      return Promise.resolve({ data: [] });
    }
    return Promise.reject(new Error(`Unexpected GET in dialog test: ${url}`));
  });
});

function inEnglish(children: ReactNode) {
  return <LocaleProvider initialLocale="en">{children}</LocaleProvider>;
}

describe("migrated dialog record isolation", () => {
  it("remounts a care report when its report target changes", async () => {
    const user = userEvent.setup();
    const callbacks = { onClose: vi.fn(), onSaved: vi.fn() };
    const { rerender } = render(
      inEnglish(
        <CareReportModal
          type={"GENERAL" as CareReportType}
          studentIds={["student-1"]}
          studentLabel="Student one"
          {...callbacks}
        />
      )
    );

    const firstNote = document.querySelector<HTMLTextAreaElement>("textarea");
    expect(firstNote).not.toBeNull();
    await user.type(firstNote!, "must not leak");
    expect(firstNote!.value).toBe("must not leak");

    rerender(
      inEnglish(
        <CareReportModal
          type={"HEALTH" as CareReportType}
          studentIds={["student-2"]}
          studentLabel="Student two"
          {...callbacks}
        />
      )
    );

    await waitFor(() => expect(screen.getByText("Student two")).not.toBeNull());
    const secondNote = document.querySelector<HTMLTextAreaElement>("textarea");
    expect(secondNote?.value).toBe("");
    expect(screen.queryByDisplayValue("must not leak")).toBeNull();
  });

  it("remounts the calendar form when a different event is opened", async () => {
    const user = userEvent.setup();
    const common = {
      defaultDate: new Date("2026-08-10T08:00:00.000Z"),
      classes: [],
      teachers: [],
      onClose: vi.fn(),
      onSaved: vi.fn(),
    };
    const firstEvent = {
      id: "event-1",
      type: "LESSON" as CalendarEventType,
      title: "First event",
      description: null,
      startAt: "2026-08-10T08:00:00.000Z",
      endAt: null,
      allDay: false,
      teacherId: null,
      location: null,
      classIds: [],
    };
    const { rerender } = render(
      inEnglish(<CalendarEventModal event={firstEvent} activity={null} {...common} />)
    );

    const title = screen.getByDisplayValue("First event");
    await user.clear(title);
    await user.type(title, "Stale title");

    rerender(
      inEnglish(
        <CalendarEventModal
          event={{ ...firstEvent, id: "event-2", title: "Second event" }}
          activity={null}
          {...common}
        />
      )
    );

    await waitFor(() => expect(screen.getByDisplayValue("Second event")).not.toBeNull());
    expect(screen.queryByDisplayValue("Stale title")).toBeNull();
  });

  it("initializes the shift editor from each newly opened cell", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockResolvedValue({
      data: {
        weekStart: "2026-08-09",
        days: ["2026-08-10", "2026-08-11"],
        teachers: [{ id: "teacher-1", name: "Teacher one" }],
        classes: [],
        shifts: [
          {
            id: "shift-1",
            teacherId: "teacher-1",
            teacherName: "Teacher one",
            classId: null,
            className: null,
            date: "2026-08-10",
            startTime: "07:00",
            endTime: "15:00",
            role: null,
            notes: null,
          },
          {
            id: "shift-2",
            teacherId: "teacher-1",
            teacherName: "Teacher one",
            classId: null,
            className: null,
            date: "2026-08-11",
            startTime: "10:00",
            endTime: "18:00",
            role: null,
            notes: null,
          },
        ],
      },
    });

    render(inEnglish(<ShiftsPanel />));
    await user.click(await screen.findByRole("button", { name: /07:00/ }));

    let dialog = screen.getByRole("dialog");
    let timeInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="time"]');
    expect(Array.from(timeInputs, (input) => input.value)).toEqual(["07:00", "15:00"]);
    await user.clear(timeInputs[0]);
    await user.type(timeInputs[0], "09:30");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: /10:00/ }));
    dialog = screen.getByRole("dialog");
    timeInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="time"]');
    expect(Array.from(timeInputs, (input) => input.value)).toEqual(["10:00", "18:00"]);
  });
});
