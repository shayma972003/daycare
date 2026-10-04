import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(...segments: string[]) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

describe("mobile care tab", () => {
  it("is visible to guardian and staff accounts", () => {
    const guardianLayout = source("mobile", "src", "app", "(guardian)", "_layout.tsx");
    const staffLayout = source("mobile", "src", "app", "(staff)", "_layout.tsx");

    expect(guardianLayout).toContain('name="care"');
    expect(staffLayout).toContain('name="care"');
    expect(guardianLayout).toContain('tabBarAccessibilityLabel: "تقارير الرعاية"');
    expect(staffLayout).toContain('tabBarAccessibilityLabel: "تقارير الرعاية"');
  });

  it("keeps guardian reports read-only and child scoped", () => {
    const api = source("mobile", "src", "api", "care.ts");
    const screen = source("mobile", "src", "components", "guardian-care-screen.tsx");

    expect(api).toContain("loadGuardianCareReports");
    expect(api).toContain("encodeURIComponent(studentId)");
    expect(screen).toContain("لا توجد تقارير معتمدة بعد");
    expect(screen).not.toContain("createCareReports");
  });

  it("uses one shared meal and a separate care row for every selected child", () => {
    const api = source("mobile", "src", "api", "care.ts");
    const screen = source("mobile", "src", "components", "staff-care-screen.tsx");

    expect(api).toContain('request<{ children: CareStudent[] }>("/api/mobile/v1/attendance/today")');
    expect(api).toContain('"/api/mobile/v1/care-reports/daily"');
    expect(screen).toContain("الوجبة المشتركة");
    expect(screen).toContain("تفاصيل الأطفال");
    expect(screen).toContain("كمية الوجبة");
    expect(screen).toContain("إرسال التقارير للمراجعة");
    expect(screen).toContain("إرسال التقارير مباشرة");
    expect(api).toContain("loadCareReportPolicy");
    expect(screen).toContain("selectedIds");
  });

  it("separates new reports from returned reports and allows resubmission", () => {
    const api = source("mobile", "src", "api", "care.ts");
    const screen = source("mobile", "src", "components", "staff-care-screen.tsx");
    const returnedRoute = source(
      "src", "app", "api", "mobile", "v1", "care-reports", "returned", "route.ts"
    );
    const resubmitRoute = source(
      "src", "app", "api", "mobile", "v1", "care-reports", "returned", "[batchId]", "resubmit", "route.ts"
    );

    expect(screen).toContain("إنشاء التقارير");
    expect(screen).toContain("مرتجعة للتعديل");
    expect(screen).toContain("ملاحظة الإدارة");
    expect(api).toContain("loadReturnedDailyCareReports");
    expect(api).toContain("resubmitReturnedDailyCareReport");
    expect(returnedRoute).toContain('reviewStatus: "REJECTED"');
    expect(returnedRoute).toContain("studentClassWhere(context)");
    expect(resubmitRoute).toContain("dailyReportSchema.safeParse");
    expect(resubmitRoute).toContain('reviewStatus: "PENDING_REVIEW"');
  });

  it("keeps care details optional and uses an easy time picker", () => {
    const screen = source("mobile", "src", "components", "staff-care-screen.tsx");

    expect(screen).toContain("كل الحقول اختيارية");
    expect(screen).toContain("وقت الوجبة (اختياري)");
    expect(screen).toContain("اختاري الساعة والدقيقة");
    expect(screen).toContain("TimePickerField");
    expect(screen).not.toContain("numbers-and-punctuation");
    expect(screen).not.toContain("حددي كمية الوجبة لكل طفل");
    expect(screen).not.toContain("أكملي اسم الدواء والجرعة والوقت");
  });

  it("saves mobile daily care through the same validated batch builder as the desktop", () => {
    const route = source(
      "src", "app", "api", "mobile", "v1", "care-reports", "daily", "route.ts"
    );

    expect(route).toContain("dailyReportSchema.safeParse");
    expect(route).toContain("buildDailyCareRows");
    expect(route).toContain("dailyCareRequestHash");
    expect(route).toContain("studentClassWhere(context)");
    expect(route).toContain('permission: "attendance.students"');
    expect(route).toContain("assertNoDailyCareReportsToday");
    expect(route).toContain("DAILY_REPORT_ALREADY_SUBMITTED");
  });

  it("removes children already reported today from the creation form", () => {
    const api = source("mobile", "src", "api", "care.ts");
    const screen = source("mobile", "src", "components", "staff-care-screen.tsx");
    const roster = source("src", "app", "api", "mobile", "v1", "attendance", "today", "route.ts");

    expect(api).toContain("hasDailyCareReportToday");
    expect(screen).toContain("reportableStudents");
    expect(screen).toContain("تم إرسال تقارير جميع الأطفال اليوم");
    expect(roster).toContain("hasDailyCareReportToday");
    expect(roster).toContain("care_reports");
  });
});
