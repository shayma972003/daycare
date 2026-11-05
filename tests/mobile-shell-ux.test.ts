import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");

describe("mobile shared shell UX", () => {
  const appScreen = source("mobile", "src", "components", "app-screen.tsx");
  const language = source("mobile", "src", "language.tsx");

  it("mirrors Arabic layout and text instead of only translating labels", () => {
    expect(language).toContain("I18nManager.allowRTL(false)");
    expect(language).toContain("I18nManager.forceRTL(false)");
    expect(language).toContain("I18nManager.swapLeftAndRightInRTL(false)");
    expect(appScreen).not.toContain('direction: isRTL ? "rtl" : "ltr"');
    expect(appScreen).toContain('flexDirection: isRTL ? "row-reverse" : "row"');
    expect(language).toContain('textAlign: centered ? "center" : isRTL ? "right" : "left"');
  });

  it("offers a keyboard-safe bilingual sign-in with password visibility", () => {
    const signIn = source("mobile", "src", "app", "sign-in.tsx");
    const appConfig = source("mobile", "app.json");
    expect(signIn).toContain('setLanguage(language === "ar" ? "en" : "ar")');
    expect(signIn).toContain('behavior={Platform.OS === "ios" ? "padding" : "height"}');
    expect(signIn).toContain("automaticallyAdjustKeyboardInsets");
    expect(signIn).toContain('keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}');
    expect(signIn).toContain("secureTextEntry={!passwordVisible}");
    expect(signIn).toContain('android: passwordVisible ? "visibility_off" : "visibility"');
    expect(signIn).toContain('writingDirection: isRTL ? "rtl" : "ltr"');
    expect(signIn).toContain('textAlign={isRTL ? "right" : "left"}');
    expect(signIn).toContain('alignItems: isRTL ? "flex-start" : "flex-end"');
    expect(appConfig).toContain('"softwareKeyboardLayoutMode": "resize"');
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
    expect(location).toContain('return resultFor("active", current');
    expect(notifications).toContain("تم تسجيل دخولك تلقائيًا");
    expect(notifications).toContain("تم تسجيل خروجك تلقائيًا");
    expect(notifications).toContain("shouldPlaySound: true");
  });
});
