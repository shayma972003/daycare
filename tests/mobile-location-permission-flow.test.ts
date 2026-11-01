import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");

describe("mobile location attendance permission flow", () => {
  it("requests location after a linked teacher signs in", () => {
    const session = source("mobile", "src", "session.tsx");
    expect(session).toContain("account.kind === \"staff\" && account.teacherId");
    expect(session).toContain("syncLocationAttendance({ requestPermissions: true })");
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
});
