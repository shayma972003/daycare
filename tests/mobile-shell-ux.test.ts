import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");

describe("mobile shared shell UX", () => {
  const appScreen = source("mobile", "src", "components", "app-screen.tsx");
  const language = source("mobile", "src", "language.tsx");

  it("mirrors Arabic layout and text instead of only translating labels", () => {
    expect(language).toContain("I18nManager.allowRTL(true)");
    expect(language).toContain('I18nManager.forceRTL(next === "ar")');
    expect(appScreen).toContain('direction: isRTL ? "rtl" : "ltr"');
    expect(language).toContain('textAlign: centered ? "center" : isRTL ? "right" : "left"');
  });

  it("offers language switching on sign-in with language-aware field direction", () => {
    const signIn = source("mobile", "src", "app", "sign-in.tsx");
    expect(signIn).toContain('setLanguage(language === "ar" ? "en" : "ar")');
    expect(signIn).toContain('direction: isRTL ? "rtl" : "ltr"');
    expect(signIn).toContain('writingDirection: isRTL ? "rtl" : "ltr"');
    expect(signIn).toContain('textAlign={isRTL ? "right" : "left"}');
  });

  it("uses the native pull-to-refresh gesture in the shared page container", () => {
    expect(appScreen).toContain("RefreshControl");
    expect(appScreen).toContain("onRefresh");
    expect(appScreen).toContain("refreshing");
  });

  it("keeps sign out only in account/settings screens", () => {
    const contentScreens = [
      "calendar-screen.tsx",
      "guardian-home-screen.tsx",
      "guardian-care-screen.tsx",
      "guardian-notifications-screen.tsx",
      "staff-home-screen.tsx",
      "staff-attendance-screen.tsx",
      "staff-care-screen.tsx",
    ];
    for (const file of contentScreens) {
      expect(source("mobile", "src", "components", file)).not.toContain("signOut()");
    }
    expect(source("mobile", "src", "components", "guardian-account-screen.tsx")).toContain("signOut()");
    expect(source("mobile", "src", "components", "staff-account-screen.tsx")).toContain("signOut()");
  });

  it("shows automatic attendance state and keeps local check-in/out notifications enabled", () => {
    const card = source("mobile", "src", "components", "location-attendance-settings-card.tsx");
    const location = source("mobile", "src", "location-attendance", "index.native.ts");
    const notifications = source("mobile", "src", "notifications", "device.native.ts");

    expect(card).toContain("حالتك الآن");
    expect(card).toContain("مسجلة دخول");
    expect(card).toContain("مسجلة خروج");
    expect(location).toContain("attendanceOpen: current.attendanceOpen");
    expect(notifications).toContain("تم تسجيل دخولك تلقائيًا");
    expect(notifications).toContain("تم تسجيل خروجك تلقائيًا");
    expect(notifications).toContain("shouldPlaySound: true");
  });
});
