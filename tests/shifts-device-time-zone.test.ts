import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  teachers: vi.fn(),
  classes: vi.fn(),
  shifts: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => ({
    user: { schoolId: "school-1", name: "Scheduler" },
    can: (permission: string) => permission === "schedule.view",
  })),
  sessionErrorResponse: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teacher: { findMany: mocks.teachers },
    class: { findMany: mocks.classes },
    shift: { findMany: mocks.shifts },
  },
}));

vi.mock("@/lib/activity-logger", () => ({ logAction: vi.fn() }));

import { GET } from "@/app/api/shifts/route";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-30T01:00:00.000Z"));
  mocks.teachers.mockResolvedValue([]);
  mocks.classes.mockResolvedValue([]);
  mocks.shifts.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function weekFor(timeZone: string) {
  const response = await GET(new Request("http://localhost/api/shifts", {
    headers: { "X-Time-Zone": timeZone },
  }));
  expect(response.status).toBe(200);
  return response.json() as Promise<{ weekStart: string; days: string[] }>;
}

describe("shift default week in the device time zone", () => {
  it("uses the device-local day at the Sunday boundary", async () => {
    const tokyo = await weekFor("Asia/Tokyo");
    const losAngeles = await weekFor("America/Los_Angeles");

    expect(tokyo.weekStart).toBe("2026-08-30");
    expect(tokyo.days.at(0)).toBe("2026-08-30");
    expect(losAngeles.weekStart).toBe("2026-08-23");
    expect(losAngeles.days.at(-1)).toBe("2026-08-29");
  });

  it("rejects an invalid zone before querying shift data", async () => {
    const response = await GET(new Request("http://localhost/api/shifts", {
      headers: { "X-Time-Zone": "Not/A-Time-Zone" },
    }));

    expect(response.status).toBe(422);
    expect(mocks.shifts).not.toHaveBeenCalled();
  });
});
