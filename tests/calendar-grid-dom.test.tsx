// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n-provider";
import { HourGrid, MonthGrid } from "@/app/(dashboard)/calendar/page";
import type { CalendarEventType } from "@/generated/prisma/enums";

afterEach(cleanup);

const day = new Date("2026-09-02T00:00:00.000Z");
const base = {
  description: null,
  teacherId: null,
  location: null,
  classIds: [],
  unit: null,
};
const timed = (id: string, title: string) => ({
  ...base,
  id,
  source: "event" as const,
  sourceId: id,
  kind: "event" as const,
  timing: "timed" as const,
  type: "LESSON" as CalendarEventType,
  title,
  startAt: "2026-09-02T09:15:00.000Z",
  endAt: "2026-09-02T12:30:00.000Z",
  allDay: false,
});

function english(node: React.ReactNode) {
  return <LocaleProvider initialLocale="en">{node}</LocaleProvider>;
}

describe("calendar grids", () => {
  it("renders timed entries once at their start hour, side by side, without truncating long titles", () => {
    const long = "A complete title that must wrap instead of being shortened";
    render(english(<HourGrid
      days={[day]}
      hours={[9, 10, 11, 12]}
      eventsOn={() => [timed("one", long), timed("two", "Second event")]}
      shiftOn={() => []}
      locale="en"
      timeZone="UTC"
      onSelect={vi.fn()}
    />));
    expect(screen.getAllByText(long)).toHaveLength(1);
    const button = screen.getByRole("button", { name: long });
    expect(button.className).toContain("whitespace-normal");
    expect(button.className).not.toContain("truncate");
    expect(button.parentElement?.className).toContain("flex-wrap");
  });

  it("puts all-day items in the dedicated region rather than an hour", () => {
    const allDay = {
      ...timed("all", "All-day programme"),
      timing: "allDay" as const,
      startAt: "2026-09-02T00:00:00.000Z",
      endAt: "2026-09-03T00:00:00.000Z",
      allDay: true,
    };
    render(english(<HourGrid days={[day]} hours={[0, 1]} eventsOn={() => [allDay]}
      shiftOn={() => []} locale="en" timeZone="UTC" onSelect={vi.fn()} />));
    expect(screen.getAllByText("All-day programme")).toHaveLength(1);
    expect(screen.getByText("All day").parentElement?.className).toContain("bg-gray-50/50");
  });

  it("opens the complete day list from the month more control", () => {
    const entries = Array.from({ length: 5 }, (_, index) => timed(String(index), `Event ${index + 1}`));
    render(english(<MonthGrid days={[day]} anchor={day} eventsOn={() => entries}
      onSelect={vi.fn()} timeZone="UTC" />));
    expect(screen.queryByText("Event 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
    expect(screen.getByText("Event 5")).not.toBeNull();
  });
});
