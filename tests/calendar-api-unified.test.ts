import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calendarFindMany: vi.fn(),
  activityFindMany: vi.fn(),
  classFindMany: vi.fn(),
  can: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => ({
    user: { id: "user-1", schoolId: "school-1" },
    can: mocks.can,
  })),
  sessionErrorResponse: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    calendarEvent: { findMany: mocks.calendarFindMany },
    activity: { findMany: mocks.activityFindMany },
    class: { findMany: mocks.classFindMany },
  },
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/tenant-guard", () => ({
  assertTeacherOwned: vi.fn(), assertClassOwned: vi.fn(), crossTenantResponse: vi.fn(),
}));

import { GET } from "@/app/api/calendar/route";

const event = {
  id: "same-id",
  schoolId: "school-1",
  type: "ACTIVITY",
  title: "Calendar activity",
  description: null,
  startAt: new Date("2026-09-02T09:00:00.000Z"),
  endAt: new Date("2026-09-02T10:00:00.000Z"),
  allDay: false,
  teacherId: null,
  unitId: null,
  lessonId: null,
  location: null,
  createdByName: "Manager",
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  classes: [],
  unit: null,
  lesson: null,
};
const activity = {
  id: "same-id",
  schoolId: "school-1",
  name: "Programme",
  teacherId: null,
  group: "KG1",
  stageId: null,
  period: "MORNING",
  childrenCount: 0,
  startDate: new Date("2026-09-02T00:00:00.000Z"),
  endDate: new Date("2026-09-03T00:00:00.000Z"),
  allDay: null,
  activityFee: 20,
  imageUrl: null,
  message: "Message",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  activityInvites: [{ classId: "class-1" }],
  teacher: null,
  stage: null,
};

function calendarRequest(query = "") {
  return new Request(`http://localhost/api/calendar?from=2026-09-01T00:00:00.000Z&to=2026-09-05T00:00:00.000Z&fromDate=2026-09-01&toDate=2026-09-05${query}`, {
    headers: { "X-Time-Zone": "UTC" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calendarFindMany.mockResolvedValue([event]);
  mocks.activityFindMany.mockResolvedValue([activity]);
  mocks.classFindMany.mockResolvedValue([{ id: "class-1", name: "Room one" }]);
  mocks.can.mockImplementation((permission: string) => permission === "schedule.view");
});

describe("unified calendar API", () => {
  it("keeps source identity distinct and normalizes legacy activity dates", async () => {
    const response = await GET(calendarRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const rows = await response.json();
    expect(rows.map((row: { source: string; sourceId: string }) => `${row.source}:${row.sourceId}`))
      .toEqual(["event:same-id", "activity:same-id"]);
    expect(rows[1]).toMatchObject({
      timing: "legacyDate",
      allDay: true,
      startAt: "2026-09-02T00:00:00.000Z",
      endAt: "2026-09-04T00:00:00.000Z",
      classNames: ["Room one"],
      activity: { fee: 20, message: "Message", allDay: null },
    });
  });

  it("applies a non-activity type filter to both data sources", async () => {
    mocks.calendarFindMany.mockResolvedValue([{ ...event, type: "LESSON", title: "Lesson" }]);
    const response = await GET(calendarRequest("&type=LESSON"));
    expect(response.status).toBe(200);
    expect(mocks.activityFindMany).not.toHaveBeenCalled();
    expect((await response.json()).map((row: { title: string }) => row.title)).toEqual(["Lesson"]);
  });

  it("pushes class and teacher filters into both source queries", async () => {
    const response = await GET(calendarRequest("&type=ACTIVITY&classId=class-1&teacherId=teacher-1"));
    expect(response.status).toBe(200);

    expect(mocks.calendarFindMany.mock.calls[0][0].where).toMatchObject({
      schoolId: "school-1",
      teacherId: "teacher-1",
      type: "ACTIVITY",
    });
    expect(mocks.calendarFindMany.mock.calls[0][0].where.AND[1]).toEqual({
      OR: [
        { classes: { some: { classId: "class-1" } } },
        { classes: { none: {} } },
      ],
    });
    expect(mocks.activityFindMany.mock.calls[0][0].where).toMatchObject({
      schoolId: "school-1",
      teacherId: "teacher-1",
      OR: [
        { activityInvites: { some: { classId: "class-1" } } },
        { activityInvites: { none: {} } },
      ],
    });
  });

  it("requires view permission before either source is queried", async () => {
    mocks.can.mockReturnValue(false);
    const response = await GET(calendarRequest());
    expect(response.status).toBe(403);
    expect(mocks.calendarFindMany).not.toHaveBeenCalled();
    expect(mocks.activityFindMany).not.toHaveBeenCalled();
  });
});
