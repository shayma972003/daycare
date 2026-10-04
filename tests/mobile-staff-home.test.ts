import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(...segments: string[]) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

describe("mobile staff home", () => {
  const route = source("mobile", "src", "app", "(staff)", "index.tsx");
  const screen = source("mobile", "src", "components", "staff-home-screen.tsx");

  it("contains only the three approved daily sections", () => {
    expect(route).toContain("StaffHomeScreen");
    expect(screen).toContain('title="حضور اليوم"');
    expect(screen).toContain('title="تقارير الرعاية المرجعة"');
    expect(screen).toContain('title="أحداث اليوم"');
    expect(screen).not.toContain("الفصول والأطفال");
    expect(screen).not.toContain("تسجيل الخروج");
    expect(screen).not.toContain("أهلًا");
  });

  it("loads each section from its scoped mobile endpoint", () => {
    expect(screen).toContain("loadArrivalNotices()");
    expect(screen).toContain("loadTodayAttendance()");
    expect(screen).toContain("loadReturnedDailyCareReports()");
    expect(screen).toContain("loadCalendar(today, today)");
    expect(screen).toContain("Promise.allSettled");
  });

  it("keeps selected parent arrivals visible until staff acknowledges them", () => {
    const api = source("mobile", "src", "api", "arrival.ts");
    expect(screen).toContain("سيصل {arrivalNotice.senderName} خلال 5 دقائق");
    expect(screen).toContain("حسنًا");
    expect(screen).toContain("acknowledgeArrivalNotice(notice.id)");
    expect(screen).toContain("15_000");
    expect(api).toContain('method: "PATCH"');
  });

  it("uses the Riyadh date and links each summary to its full tab", () => {
    expect(screen).toContain("riyadhDateKey(new Date())");
    expect(screen).toContain('router.push("/(staff)/attendance")');
    expect(screen).toContain('router.push("/(staff)/care")');
    expect(screen).toContain('router.push("/(staff)/calendar")');
  });
});
