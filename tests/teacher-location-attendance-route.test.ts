import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  schoolFind: vi.fn(),
  attendanceFind: vi.fn(),
  checkin: vi.fn(),
  checkout: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/mobile-guard", () => ({
  requireMobileAuth: mocks.auth,
  mobileAuthResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: mocks.schoolFind },
    teacherAttendance: { findFirst: mocks.attendanceFind },
  },
}));
vi.mock("@/lib/attendance-operations", () => ({
  AttendanceOperationError: class AttendanceOperationError extends Error {},
  checkInTeacher: mocks.checkin,
  checkoutTeacher: mocks.checkout,
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));
vi.mock("@/lib/device-date", () => ({
  calendarToday: () => new Date("2026-10-27T00:00:00.000Z"),
  requestTimeZone: () => "Asia/Riyadh",
}));

import { GET, POST } from "@/app/api/mobile/v1/teacher-attendance/location/route";

const school = {
  locationAttendanceEnabled: true,
  locationLatitude: 24.7136,
  locationLongitude: 46.6753,
  locationCheckinRadiusMeters: 100,
  locationCheckoutRadiusMeters: 150,
  locationMaxAccuracyMeters: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    schoolId: "school-1",
    teacherId: "teacher-1",
    claims: { sub: "user-1", kind: "staff" },
  });
  mocks.schoolFind.mockResolvedValue(school);
  mocks.attendanceFind.mockResolvedValue(null);
  mocks.log.mockResolvedValue(undefined);
});

function post(body: unknown) {
  return POST(new Request("http://localhost/api/mobile/v1/teacher-attendance/location", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Time-Zone": "Asia/Riyadh" },
    body: JSON.stringify(body),
  }));
}

describe("mobile teacher location attendance route", () => {
  it("returns only the signed-in teacher's configuration and open state", async () => {
    mocks.attendanceFind.mockResolvedValue({ id: "attendance-1", checkinAt: new Date("2026-10-27T05:00:00.000Z") });
    const response = await GET(new Request("http://localhost/api/mobile/v1/teacher-attendance/location"));
    expect(response.status).toBe(200);
    expect(mocks.attendanceFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ schoolId: "school-1", teacherId: "teacher-1", checkoutAt: null }),
    }));
    await expect(response.json()).resolves.toMatchObject({ enabled: true, attendanceOpen: true });
  });

  it("rejects an inaccurate fix before writing attendance", async () => {
    const response = await post({
      eventId: "event-low-accuracy",
      action: "checkin",
      latitude: 24.7136,
      longitude: 46.6753,
      accuracyMeters: 250,
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "LOCATION_ACCURACY_LOW" });
    expect(mocks.checkin).not.toHaveBeenCalled();
  });

  it("records an in-range check-in with server-validated location metadata", async () => {
    mocks.checkin.mockResolvedValue({
      id: "attendance-1",
      checkinAt: new Date("2026-10-27T05:00:00.000Z"),
      personName: "المعلمة سارة",
    });
    const response = await post({
      eventId: "event-checkin-0001",
      action: "checkin",
      latitude: 24.7136,
      longitude: 46.6753,
      accuracyMeters: 12,
    });
    expect(response.status).toBe(200);
    expect(mocks.checkin).toHaveBeenCalledWith(expect.objectContaining({
      schoolId: "school-1",
      teacherId: "teacher-1",
      timeZone: "Asia/Riyadh",
      location: { eventId: "event-checkin-0001", distanceMeters: 0, accuracyMeters: 12 },
    }));
    await expect(response.json()).resolves.toMatchObject({ recorded: true, action: "checkin" });
  });

  it("treats a repeated event id as idempotent", async () => {
    mocks.attendanceFind.mockResolvedValue({
      id: "attendance-1",
      checkinAt: new Date("2026-10-27T05:00:00.000Z"),
      checkoutAt: null,
    });
    const response = await post({
      eventId: "event-checkin-repeat",
      action: "checkin",
      latitude: 24.7136,
      longitude: 46.6753,
      accuracyMeters: 10,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ recorded: false, duplicate: true });
    expect(mocks.checkin).not.toHaveBeenCalled();
  });

  it("records check-out only after the wider exit boundary", async () => {
    mocks.checkout.mockResolvedValue({
      attendanceId: "attendance-1",
      checkoutAt: new Date("2026-10-27T13:00:00.000Z"),
      personName: "المعلمة سارة",
    });
    const response = await post({
      eventId: "event-checkout-0001",
      action: "checkout",
      latitude: 24.7154,
      longitude: 46.6753,
      accuracyMeters: 15,
    });
    expect(response.status).toBe(200);
    expect(mocks.checkout).toHaveBeenCalledWith(expect.objectContaining({
      schoolId: "school-1",
      teacherId: "teacher-1",
      location: expect.objectContaining({ eventId: "event-checkout-0001", accuracyMeters: 15 }),
    }));
    await expect(response.json()).resolves.toMatchObject({ recorded: true, action: "checkout" });
  });
});
