import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");

describe("mobile location attendance permission flow", () => {
  it("requests location after a linked teacher signs in", () => {
    const session = source("mobile", "src", "session.tsx");
    expect(session).toContain("account.kind === \"staff\" && account.teacherId");
    expect(session).toContain("requestPermissions: true");
    expect(session).toContain("requestServices: true");
    expect(session).toContain("تفعيل الحضور التلقائي");
  });

  it("keeps the location card visible when the account still needs linking", () => {
    const account = source("mobile", "src", "components", "staff-account-screen.tsx");
    const card = source("mobile", "src", "components", "location-attendance-settings-card.tsx");
    expect(account).toContain("<LocationAttendanceSettingsCard linked={Boolean(account.teacherId)} />");
    expect(card).toContain("اربط حساب التطبيق بملف الموظف");
  });

  it("declares foreground and background location support in the native build", () => {
    const config = JSON.parse(source("mobile", "app.json")) as {
      expo: { plugins: unknown[] };
    };
    const location = config.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-location"
    ) as [string, Record<string, unknown>] | undefined;
    expect(location?.[1].isAndroidBackgroundLocationEnabled).toBe(true);
    expect(location?.[1].locationWhenInUsePermission).toBeTruthy();
    expect(location?.[1].locationAlwaysAndWhenInUsePermission).toBeTruthy();
  });

  it("separates app permission from the device location service and refreshes after settings", () => {
    const location = source("mobile", "src", "location-attendance", "index.native.ts");
    const card = source("mobile", "src", "components", "location-attendance-settings-card.tsx");
    expect(location).toContain("Location.hasServicesEnabledAsync()");
    expect(location).toContain("Location.enableNetworkProviderAsync()");
    expect(location).toContain('resultFor("services-disabled"');
    expect(card).toContain('AppState.addEventListener("change"');
    expect(card).toContain("إذن التطبيق");
    expect(card).toContain("موقع الجهاز");
  });

  it("shows the employee's current check-in state on the home screen", () => {
    const home = source("mobile", "src", "components", "staff-home-screen.tsx");
    expect(home).toContain("loadLocationAttendanceSettings");
    expect(home).toContain('title="حضورك الآن"');
    expect(home).toContain("مسجلة دخول");
    expect(home).toContain("مسجلة خروج");
  });
});
