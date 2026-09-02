import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolveStudentCycleFee } from "@/lib/student-cycle-fee";
import { scheduleFor, validateSchoolSchedule } from "@/lib/school-schedule";
import { zonedTimeOnDate } from "@/lib/device-date";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  settingsFind: vi.fn(),
  schoolFind: vi.fn(),
  settingsUpsert: vi.fn(),
  schoolUpdate: vi.fn(),
  transaction: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.logAction }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    settings: { findUnique: mocks.settingsFind },
    school: { findUnique: mocks.schoolFind },
    $transaction: mocks.transaction,
  },
}));

import { PUT as updateSettings } from "@/app/api/settings/route";

const schedule = {
  teacherMorningCheckinTime: "07:00",
  teacherMorningCheckoutTime: "15:00",
  teacherEveningCheckinTime: "15:30",
  teacherEveningCheckoutTime: "22:00",
  studentMorningCheckinTime: "07:30",
  studentMorningCheckoutTime: "14:00",
  studentEveningCheckinTime: "16:00",
  studentEveningCheckoutTime: "21:30",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    user: { id: "manager-1", schoolId: "school-1", name: "Manager" },
    can: (permission: string) => permission === "settings.manage",
  });
  mocks.schoolFind.mockResolvedValue(schedule);
  mocks.settingsFind.mockResolvedValue({ schoolId: "school-1" });
  mocks.settingsUpsert.mockResolvedValue({ schoolId: "school-1" });
  mocks.schoolUpdate.mockResolvedValue({ id: "school-1" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    settings: { upsert: mocks.settingsUpsert, findUnique: mocks.settingsFind },
    school: { update: mocks.schoolUpdate },
  }));
  mocks.logAction.mockResolvedValue(undefined);
});

describe("school schedules and student fee settings", () => {
  it("keeps the legacy schedule columns during the reviewed rollout migration", () => {
    const migration = readFileSync(
      "prisma/migrations/20260902120000_school_schedule_and_subscription_fees/migration.sql",
      "utf8"
    );
    for (const field of ["teacherCheckinTime", "teacherCheckoutTime", "studentCheckinTime", "studentCheckoutTime"]) {
      expect(migration).toContain(`= "${field}"`);
      expect(migration).not.toContain(`DROP COLUMN "${field}"`);
    }
  });

  it("keeps all four audience/period schedules independent", () => {
    expect(scheduleFor(schedule, "teacher", "MORNING")).toEqual({ checkin: "07:00", checkout: "15:00" });
    expect(scheduleFor(schedule, "teacher", "EVENING")).toEqual({ checkin: "15:30", checkout: "22:00" });
    expect(scheduleFor(schedule, "student", "MORNING")).toEqual({ checkin: "07:30", checkout: "14:00" });
    expect(scheduleFor(schedule, "student", "EVENING")).toEqual({ checkin: "16:00", checkout: "21:30" });
    expect(validateSchoolSchedule(schedule)).toBeNull();
  });

  it("rejects half-filled and non-forward schedules", () => {
    expect(validateSchoolSchedule({ ...schedule, studentEveningCheckoutTime: null })).toBe("INCOMPLETE_SCHEDULE");
    expect(validateSchoolSchedule({ ...schedule, teacherMorningCheckoutTime: "07:00" })).toBe("INVALID_SCHEDULE_RANGE");
    expect(validateSchoolSchedule({ ...schedule, teacherMorningCheckoutTime: "06:59" })).toBe("INVALID_SCHEDULE_RANGE");
  });

  it("converts a calendar schedule using the device zone near midnight", () => {
    const date = new Date("2026-09-01T00:00:00.000Z");
    expect(zonedTimeOnDate(date, "00:15", "America/Los_Angeles")?.toISOString()).toBe("2026-09-01T07:15:00.000Z");
    expect(zonedTimeOnDate(date, "23:45", "Asia/Tokyo")?.toISOString()).toBe("2026-09-01T14:45:00.000Z");
  });

  it("resolves daily, weekly, monthly and yearly fees and preserves zero", () => {
    const fees = { dailyStudentFee: 0, weeklyStudentFee: 70, monthlyStudentFee: 250, yearlyStudentFee: 2500 };
    expect(String(resolveStudentCycleFee("DAILY", null, fees))).toBe("0");
    expect(String(resolveStudentCycleFee("WEEKLY", null, fees))).toBe("70");
    expect(String(resolveStudentCycleFee("MONTHLY", null, fees))).toBe("250");
    expect(String(resolveStudentCycleFee("YEARLY", null, fees))).toBe("2500");
    expect(resolveStudentCycleFee("CUSTOM", null, fees)).toBeNull();
  });

  it("rejects school identity fields from the tenant settings endpoint", async () => {
    for (const field of ["schoolName", "email", "commercialRegistration", "vatNumber", "contactNumber", "phoneNumber", "address"]) {
      const response = await updateSettings(new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({ [field]: "changed" }),
      }));
      expect(response.status, field).toBe(422);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects incomplete settings in the API without writing", async () => {
    const response = await updateSettings(new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ studentMorningCheckinTime: "08:00", studentMorningCheckoutTime: null }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "INCOMPLETE_SCHEDULE" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
