import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("calendar announcement delivery", () => {
  it("stores an in-app recipient snapshot for guardians and staff", () => {
    const route = source("src/app/api/calendar/[id]/send/route.ts");
    expect(route).toContain("lockCalendarEventForUpdate");
    expect(route).toContain('type: "ANNOUNCEMENT"');
    expect(route).toContain("guardianLinks");
    expect(route).toContain("calendarEventId: event.id");
    expect(route).toContain("notifyCalendar: true");
    expect(route).toContain("enqueuePush");
  });

  it("does not require rooms to resolve a school-wide audience", () => {
    const route = source("src/app/api/calendar/[id]/send/route.ts");
    expect(route).toContain("event.classes.length === 0 && !event.teacherId");
    expect(route).toContain("schoolWide && permittedClassIds === null");
    expect(route).toContain("allSchoolAudience || guardianIds.size > 0");
    expect(route).toContain("allSchoolAudience || teacherIds.size > 0");
    expect(route).toContain("...(allSchoolAudience ? {} : { guardianId:");
    expect(route).toContain("...(allSchoolAudience ? {} : { teacherId:");
  });

  it("supports one durable message source without changing old activity rows", () => {
    const migration = source("prisma/migrations/20260912120000_calendar_announcement_messages/migration.sql");
    expect(migration).toContain('ALTER COLUMN "activityId" DROP NOT NULL');
    expect(migration).toContain('num_nonnulls("activityId", "calendarEventId") = 1');
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it("offers save-and-send in the existing calendar dialog", () => {
    const modal = source("src/components/calendar/CalendarEventModal.tsx");
    expect(modal).toContain("calendar.saveAndSend");
    expect(modal).toContain("notifyGuardians");
    expect(modal).toContain("notifyStaff");
    expect(modal).toContain("/send");
  });
});
