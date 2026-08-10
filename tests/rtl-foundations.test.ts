import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import ar from "../locales/ar.json";
import en from "../locales/en.json";
import { directionFor, forwardArrowFor, translate } from "@/lib/i18n";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const scope = [
  "src/app/layout.tsx",
  "src/app/globals.css",
  "src/components/layout/DashboardShell.tsx",
  "src/components/layout/Sidebar.tsx",
  "src/components/layout/Topbar.tsx",
  "src/components/ui/Drawer.tsx",
  "src/components/layout/CommandPalette.tsx",
  "src/app/(dashboard)/dashboard/page.tsx",
  "src/app/(dashboard)/students/page.tsx",
  "src/app/(dashboard)/teachers/page.tsx",
  "src/app/(dashboard)/classes/page.tsx",
  "src/app/(dashboard)/statistics/page.tsx",
  "src/components/activities/ActivityGrid.tsx",
  "src/components/activities/ActivityFormModal.tsx",
  "src/components/attendance/AttendanceDonut.tsx",
  "src/components/dashboard/SetupChecklist.tsx",
  "src/components/dashboard/TodayTasks.tsx",
  "src/components/teachers/ShiftsPanel.tsx",
];

const physicalUtility = /^(?:(?:left|right|m[lr]|p[lr])-.+|(?:border-[lr]|rounded-[lr])(?:-.+)?|text-(?:left|right))$/;

function stringTokens(path: string): string[] {
  if (path.endsWith(".css")) return [];
  const content = source(path);
  const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) values.push(node.text);
    if (ts.isTemplateExpression(node)) {
      values.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return values.flatMap((value) => value.split(/\s+/)).filter(Boolean);
}

function visibleLiterals(path: string): string[] {
  if (path.endsWith(".css")) return [];
  const content = source(path);
  const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: string[] = [];
  const visibleAttributes = new Set(["aria-label", "title", "placeholder", "alt"]);

  function visit(node: ts.Node) {
    if (ts.isJsxText(node) && /\p{L}/u.test(node.text)) values.push(node.text.trim());
    if (
      ts.isJsxAttribute(node) &&
      visibleAttributes.has(node.name.getText(file)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      values.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return values.filter(Boolean);
}

describe("root direction", () => {
  it("maps Arabic to RTL and English to LTR", () => {
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("en")).toBe("ltr");
  });

  it("owns lang and dir on the root html element", () => {
    const layout = source("src/app/layout.tsx");
    expect(layout).toContain('<html lang={locale} dir={directionFor(locale)}>');
  });

  it("does not force RTL from global CSS", () => {
    expect(source("src/app/globals.css")).not.toMatch(/direction\s*:\s*rtl/i);
  });

  it("does not override the root direction inside the scoped interface", () => {
    const overrides = scope.filter((path) => /direction\s*:/.test(source(path)));
    expect(overrides).toEqual([]);
  });
});

describe("logical shell and critical pages", () => {
  it("uses one logical rule for both sidebar positions and the desktop offset", () => {
    expect(source("src/components/layout/Sidebar.tsx")).toContain("fixed start-0");
    expect(source("src/components/ui/Drawer.tsx")).toContain("me-auto");
    expect(source("src/components/layout/DashboardShell.tsx")).toContain("xl:ms-[220px]");
  });

  it("contains no fixed RTL subtree or physical directional utility in scope", () => {
    const fixedRtl = scope.filter((path) => /dir\s*=\s*["']rtl["']/.test(source(path)));
    const physical = scope.flatMap((path) =>
      stringTokens(path)
        .filter((token) => physicalUtility.test(token))
        .map((token) => `${path}: ${token}`)
    );
    expect(fixedRtl).toEqual([]);
    expect(physical).toEqual([]);
  });
});

describe("bidirectional content", () => {
  it("mirrors forward navigation arrows only", () => {
    expect(forwardArrowFor("ar")).toBe("←");
    expect(forwardArrowFor("en")).toBe("→");
    expect(source("src/components/dashboard/TodayTasks.tsx")).toContain(
      "forwardArrowFor(locale)"
    );
    expect(source("src/components/ui/Drawer.tsx")).not.toContain("forwardArrowFor");
  });

  it("keeps identity, contact, time, and money content LTR", () => {
    const students = source("src/app/(dashboard)/students/page.tsx");
    const statistics = source("src/app/(dashboard)/statistics/page.tsx");
    expect(students).toMatch(/<input dir="ltr"[^>]+reviewEdit\.id_number/);
    expect(students).toMatch(/dir="ltr"[^>]+guardian_phone_1/);
    expect(students).toMatch(/dir="ltr" type="email"[^>]+guardian_email/);
    expect(statistics).toMatch(/dir="ltr">\{formatCurrency/);
    expect(source("src/components/teachers/ShiftsPanel.tsx")).toContain('type="time"');
    expect(source("src/components/activities/ActivityFormModal.tsx")).toContain(
      'className="relative" dir="ltr"'
    );
  });
});

describe("shared shell translations", () => {
  it.each(["mainNavigation", "openNavigation", "closeNavigation"])(
    "provides layout.%s in Arabic and English",
    (key) => {
      expect(translate("ar", `layout.${key}`)).not.toBe(`layout.${key}`);
      expect(translate("en", `layout.${key}`)).not.toBe(`layout.${key}`);
      expect((ar.layout as Record<string, string>)[key]).toBeTruthy();
      expect((en.layout as Record<string, string>)[key]).toBeTruthy();
    }
  );

  it.each(["shortcut", "escapeKey"])("provides palette.%s in both languages", (key) => {
    expect(translate("ar", `palette.${key}`)).not.toBe(`palette.${key}`);
    expect(translate("en", `palette.${key}`)).not.toBe(`palette.${key}`);
  });

  it("does not leave Arabic UI literals in the in-scope web interface", () => {
    const arabicLiteral = /[\u0600-\u06ff]/;
    const offenders = scope.flatMap((path) =>
      visibleLiterals(path)
        .filter((value) => arabicLiteral.test(value))
        .map((value) => `${path}: ${value}`)
    );
    expect(offenders).toEqual([]);
  });
});
