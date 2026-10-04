import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  guardianFind: vi.fn(),
  guardianUpdate: vi.fn(),
  guardianFindOrThrow: vi.fn(),
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  userFindOrThrow: vi.fn(),
}));

vi.mock("@/lib/mobile-guard", () => ({
  requireMobileAuth: mocks.auth,
  mobileAuthResponse: vi.fn(() => null),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    guardianAccount: {
      findFirst: mocks.guardianFind,
      updateMany: mocks.guardianUpdate,
      findFirstOrThrow: mocks.guardianFindOrThrow,
    },
    user: {
      findFirst: mocks.userFind,
      updateMany: mocks.userUpdate,
      findFirstOrThrow: mocks.userFindOrThrow,
    },
  },
}));

import { GET, PATCH } from "@/app/api/mobile/v1/notification-settings/route";

const ROOT = process.cwd();
const source = (...segments: string[]) => readFileSync(join(ROOT, ...segments), "utf8");

const guardianPreferences = {
  notifyActivity: true,
  notifyCalendar: false,
  notifyAbsence: true,
  notifyAttendance: false,
  notifyCareReport: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    schoolId: "school-1",
    claims: { kind: "guardian", sub: "guardian-account-1" },
  });
  mocks.guardianFind.mockResolvedValue(guardianPreferences);
  mocks.guardianFindOrThrow.mockResolvedValue(guardianPreferences);
  mocks.guardianUpdate.mockResolvedValue({ count: 1 });
  mocks.userFind.mockResolvedValue({ notifyActivity: true, notifyCalendar: true, notifyArrival: false });
  mocks.userFindOrThrow.mockResolvedValue({ notifyActivity: true, notifyCalendar: false, notifyArrival: true });
  mocks.userUpdate.mockResolvedValue({ count: 1 });
});

describe("mobile notification settings", () => {
  it("returns guardian settings without caching and scopes the read to the caller's school", async () => {
    const response = await GET(new Request("http://localhost/api/mobile/v1/notification-settings"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      kind: "guardian",
      preferences: {
        activity: true,
        calendar: false,
        absence: true,
        attendance: false,
        careReport: true,
      },
    });
    expect(mocks.guardianFind).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "guardian-account-1", schoolId: "school-1" },
    }));
  });

  it("updates only the submitted guardian preference in the authenticated tenant", async () => {
    const response = await PATCH(new Request("http://localhost/api/mobile/v1/notification-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendance: false }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.guardianUpdate).toHaveBeenCalledWith({
      where: { id: "guardian-account-1", schoolId: "school-1" },
      data: { notifyAttendance: false },
    });
  });

  it("rejects settings that do not belong to the authenticated account kind", async () => {
    const response = await PATCH(new Request("http://localhost/api/mobile/v1/notification-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arrival: false }),
    }));
    expect(response.status).toBe(422);
    expect(mocks.guardianUpdate).not.toHaveBeenCalled();
  });

  it("updates staff arrival notifications without exposing guardian-only settings", async () => {
    mocks.auth.mockResolvedValue({
      schoolId: "school-1",
      claims: { kind: "staff", sub: "user-1" },
    });
    const response = await PATCH(new Request("http://localhost/api/mobile/v1/notification-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arrival: true }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1", schoolId: "school-1" },
      data: { notifyArrival: true },
    });
    expect(await response.json()).toEqual({
      kind: "staff",
      preferences: { activity: true, calendar: false, arrival: true },
    });
  });

  it("wires every supported delivery path to its persisted preference", () => {
    expect(source("src", "app", "api", "activities", "[id]", "send", "route.ts")).toContain("notifyActivity: true");
    expect(source("src", "app", "api", "calendar", "[id]", "send", "route.ts")).toContain("notifyCalendar: true");
    expect(source("src", "lib", "absence-notifications.ts")).toContain("notifyAbsence: true");
    expect(source("src", "lib", "attendance-notifications.ts")).toContain("notifyAttendance: true");
    expect(source("src", "lib", "care-report-notify.ts")).toContain("notifyCareReport: true");
    expect(source("src", "lib", "arrival-notifications.ts")).toContain("notifyArrival: true");
  });

  it("shows the controls in My Account and embeds staff children instead of a separate tab", () => {
    const guardianAccount = source("mobile", "src", "components", "guardian-account-screen.tsx");
    const staffAccount = source("mobile", "src", "components", "staff-account-screen.tsx");
    const settings = source("mobile", "src", "components", "notification-settings-card.tsx");
    const layout = source("mobile", "src", "app", "(staff)", "_layout.tsx");
    expect(guardianAccount).toContain('<NotificationSettingsCard kind="guardian" />');
    expect(guardianAccount).toContain("أطفالي");
    expect(staffAccount).toContain("<StaffChildrenSection />");
    expect(staffAccount).toContain('<NotificationSettingsCard kind="staff" />');
    expect(settings).toContain('accessibilityRole="switch"');
    expect(settings).toContain("الحضور والانصراف");
    expect(settings).toContain("وصول أولياء الأمور");
    expect(layout).toMatch(/name="children"[\s\S]*?href: null/);
  });
});
