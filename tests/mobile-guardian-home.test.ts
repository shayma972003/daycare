import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(...segments: string[]) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

describe("mobile guardian home", () => {
  const route = source("mobile", "src", "app", "(guardian)", "index.tsx");
  const screen = source("mobile", "src", "components", "guardian-home-screen.tsx");
  const api = source("mobile", "src", "api", "arrival.ts");

  it("keeps the home concise and moves linked children to the account tab", () => {
    expect(route).toContain("GuardianHomeScreen");
    expect(screen).not.toContain("الأطفال المرتبطون");
    expect(screen).not.toContain("account.children.map");
    expect(screen).not.toContain("تسجيل الخروج");
  });

  it("offers one child-free five-minute arrival action", () => {
    expect(screen).toContain("سأصل خلال 5 دقائق");
    expect(screen).toContain("sendArrivalNotice()");
    expect(screen).toContain("remainingSeconds > 0");
    expect(api).toContain('request<ArrivalNoticeResponse>("/api/mobile/v1/arrival", { method: "POST" })');
    expect(api).not.toContain("studentId");
    expect(api).not.toContain("childId");
  });

  it("uses the server retry window after a repeated press", () => {
    const client = source("mobile", "src", "api", "client.ts");
    expect(screen).toContain('caught.code === "ARRIVAL_COOLDOWN"');
    expect(screen).toContain("caught.retryAfterSeconds");
    expect(client).toContain("readonly retryAfterSeconds?: number");
  });

  it("shows only today's events and a notice for care reports sent today", () => {
    expect(screen).toContain("loadCalendar(today, today)");
    expect(screen).toContain("loadGuardianCareReportsForDate(today)");
    expect(screen).toContain("أحداث اليوم");
    expect(screen).toContain("تم إرسال تقارير رعاية اليوم");
  });

  it("shows children and sign out in the guardian account tab", () => {
    const layout = source("mobile", "src", "app", "(guardian)", "_layout.tsx");
    const accountRoute = source("mobile", "src", "app", "(guardian)", "account.tsx");
    const accountScreen = source("mobile", "src", "components", "guardian-account-screen.tsx");
    expect(layout).toContain('name="account"');
    expect(accountRoute).toContain("GuardianAccountScreen");
    expect(accountScreen).toContain("أطفالي");
    expect(accountScreen).toContain("account.children.map");
    expect(accountScreen).toContain("تسجيل الخروج");
  });
});
