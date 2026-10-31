import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  schoolFind: vi.fn(),
  schoolUpdate: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.session,
  sessionErrorResponse: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: mocks.schoolFind, update: mocks.schoolUpdate },
  },
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.log }));

import { GET, PUT } from "@/app/api/settings/location-attendance/route";

const saved = {
  locationAttendanceEnabled: true,
  locationLatitude: 24.7136,
  locationLongitude: 46.6753,
  locationCheckinRadiusMeters: 100,
  locationCheckoutRadiusMeters: 150,
  locationMaxAccuracyMeters: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    user: { schoolId: "school-1", name: "المديرة" },
    can: (permission: string) => permission === "settings.manage",
  });
  mocks.schoolFind.mockResolvedValue(saved);
  mocks.schoolUpdate.mockResolvedValue(saved);
  mocks.log.mockResolvedValue(undefined);
});

describe("location attendance settings route", () => {
  it("returns manager-visible geofence settings", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: true,
      checkinRadiusMeters: 100,
      checkoutRadiusMeters: 150,
    });
  });

  it("requires the wider exit boundary", async () => {
    const response = await PUT(new Request("http://localhost/api/settings/location-attendance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        latitude: 24.7136,
        longitude: 46.6753,
        checkinRadiusMeters: 150,
        checkoutRadiusMeters: 100,
        maxAccuracyMeters: 100,
      }),
    }));
    expect(response.status).toBe(422);
    expect(mocks.schoolUpdate).not.toHaveBeenCalled();
  });

  it("saves a tenant-scoped location and audits the change", async () => {
    const response = await PUT(new Request("http://localhost/api/settings/location-attendance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        latitude: 24.7136,
        longitude: 46.6753,
        checkinRadiusMeters: 100,
        checkoutRadiusMeters: 150,
        maxAccuracyMeters: 100,
      }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.schoolUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "school-1" },
      data: expect.objectContaining({ locationAttendanceEnabled: true }),
    }));
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      school_id: "school-1",
      entity_type: "settings",
    }));
  });
});
