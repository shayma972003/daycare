import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function source(...segments: string[]) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

describe("mobile calendar contracts", () => {
  const route = source("src", "app", "api", "mobile", "v1", "calendar", "route.ts");

  it("authenticates every request and keeps it inside the current school", () => {
    expect(route).toContain("requireMobileAuth");
    expect(route).toContain("mobileAuthResponse");
    expect(route).toContain("schoolId: context.schoolId");
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });

  it("resolves guardian children's classes and every teacher assigned to them", () => {
    expect(route).toContain("guardianChildIds(context.claims.sub)");
    expect(route).toContain("id: { in: childIds }");
    expect(route).toContain("teacherAssignments: { select: { teacherId: true } }");
    expect(route).toContain("guardianCalendarAudience(classIds ?? [], guardianTeacherIds)");
  });

  it("returns unassigned and own events to linked staff without exposing another teacher", () => {
    expect(route).toContain("classIds = null");
    expect(route).toContain("schoolId: context.schoolId");
    expect(route).toContain("{ teacherId: null }");
    expect(route).toContain("{ teacherId: context.teacherId }");
  });

  it("is read-only and bounds the requested range and response", () => {
    expect(route).toContain("MAX_RANGE_DAYS");
    expect(route).toContain('zonedTimeOnDate(fromKey, "00:00", timeZone)');
    expect(route).toContain("take: 250");
    expect(route).not.toMatch(/calendarEvent\.(create|update|delete)/);
  });

  it("exposes the same calendar screen to guardian and staff tabs", () => {
    const guardian = source("mobile", "src", "app", "(guardian)", "calendar.tsx");
    const staff = source("mobile", "src", "app", "(staff)", "calendar.tsx");
    const guardianLayout = source("mobile", "src", "app", "(guardian)", "_layout.tsx");
    const staffLayout = source("mobile", "src", "app", "(staff)", "_layout.tsx");

    expect(guardian).toContain("CalendarScreen");
    expect(staff).toContain("CalendarScreen");
    expect(guardianLayout).toContain('name="calendar"');
    expect(staffLayout).toContain('name="calendar"');
    expect(staffLayout).not.toContain('name="nfc"');
  });

  it("offers week and month views with an icon-only refresh control", () => {
    const screen = source("mobile", "src", "components", "calendar-screen.tsx");

    expect(screen).toContain("هذا الأسبوع");
    expect(screen).toContain("الشهر");
    expect(screen).toContain("currentMonthGrid");
    expect(screen).toContain('accessibilityLabel="تحديث التقويم"');
    expect(screen).not.toContain("الأسبوع القادم");
    expect(screen).not.toContain("أحداث الأسبوع");
  });
});

describe("guardian calendar audience", () => {
  it("includes their classes, their class teachers, and fully public events", async () => {
    const { guardianCalendarAudience } = await import("../src/lib/mobile-calendar-scope");

    expect(guardianCalendarAudience(["class-1"], ["teacher-1", "teacher-2"])).toEqual({
      OR: [
        { classes: { some: { classId: { in: ["class-1"] } } } },
        { teacherId: { in: ["teacher-1", "teacher-2"] } },
        { teacherId: null, classes: { none: {} } },
      ],
    });
  });

  it("does not widen a guardian with no assigned class or teacher beyond public events", async () => {
    const { guardianCalendarAudience } = await import("../src/lib/mobile-calendar-scope");

    expect(guardianCalendarAudience([], [])).toEqual({
      OR: [{ teacherId: null, classes: { none: {} } }],
    });
  });
});

describe("mobile weekly calendar", () => {
  it("shows a spanning event on every covered day and respects an exclusive end", async () => {
    const { eventOccursOnDate } = await import("../mobile/src/calendar/week");
    const event = {
      startAt: "2026-09-25T00:00:00.000Z",
      endAt: "2026-10-03T00:00:00.000Z",
      allDay: true,
    };

    expect(eventOccursOnDate(event, "2026-09-27")).toBe(true);
    expect(eventOccursOnDate(event, "2026-10-02")).toBe(true);
    expect(eventOccursOnDate(event, "2026-10-03")).toBe(false);
  });

  it("starts the Riyadh week on Sunday and returns seven selectable days", async () => {
    const { currentWeekStart, daysFrom } = await import("../mobile/src/calendar/week");
    const start = currentWeekStart(new Date("2026-10-01T12:00:00.000Z"));

    expect(start).toBe("2026-09-27");
    expect(daysFrom(start, 7)).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("builds the complete current-month grid from Sunday through Saturday", async () => {
    const { currentMonthGrid } = await import("../mobile/src/calendar/week");
    const month = currentMonthGrid("2026-10-01");

    expect(month.monthStart).toBe("2026-10-01");
    expect(month.monthEnd).toBe("2026-10-31");
    expect(month.gridStart).toBe("2026-09-27");
    expect(month.gridEnd).toBe("2026-10-31");
    expect(month.days).toHaveLength(35);
  });
});
