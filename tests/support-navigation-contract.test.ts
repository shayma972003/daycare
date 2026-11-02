import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_VIEW_PERMISSIONS } from "@/lib/support-access";

const root = process.cwd();

describe("support tenant navigation contract", () => {
  it("can read every non-sensitive dashboard summary without receiving mutation capabilities", () => {
    expect(SUPPORT_VIEW_PERMISSIONS).toEqual(expect.arrayContaining([
      "staff.view",
      "students.view",
      "classes.view",
      "schedule.view",
      "attendance.students",
      "attendance.staff",
      "finance.view",
      "finance.subscriptions",
    ]));
    expect(SUPPORT_VIEW_PERMISSIONS.some((permission) => permission.endsWith(".manage"))).toBe(false);
    expect(SUPPORT_VIEW_PERMISSIONS).not.toContain("students.health");
  });

  it("renders all sidebar links for support and removes the normal logout action", () => {
    const sidebar = fs.readFileSync(path.join(root, "src/components/layout/Sidebar.tsx"), "utf8");
    expect(sidebar).toContain("if (supportReadOnly) return item.href !== \"/assistant\"");
    expect(sidebar).toContain("supportReadOnly || item.permission === null");
    expect(sidebar).toContain("أنهي المعاينة من الشريط الأصفر");
  });
});
