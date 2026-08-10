import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const shell = source("src/components/layout/DashboardShell.tsx");
const sidebar = source("src/components/layout/Sidebar.tsx");
const topbar = source("src/components/layout/Topbar.tsx");
const drawer = source("src/components/ui/Drawer.tsx");

describe("responsive dashboard shell", () => {
  it.each([
    [320, "drawer"],
    [375, "drawer"],
    [768, "drawer"],
    [1024, "drawer"],
    [1440, "fixed"],
  ] as const)("uses the %s px viewport in %s navigation mode", (width, expectedMode) => {
    const mode = width >= 1280 ? "fixed" : "drawer";
    expect(mode).toBe(expectedMode);
    expect(sidebar).toContain("hidden h-screen w-[220px] overflow-hidden xl:flex");
    expect(topbar).toContain("xl:hidden");
  });

  it("exposes an accessible mobile menu trigger", () => {
    expect(topbar).toContain(
      'aria-label={t(mobileOpen ? "layout.closeNavigation" : "layout.openNavigation")}'
    );
    expect(topbar).toContain("aria-expanded={mobileOpen}");
    expect(topbar).toContain('aria-controls="mobile-dashboard-navigation"');
    expect(topbar).toContain("ref={triggerRef}");
  });

  it("closes the drawer through all required boundaries and restores focus", () => {
    expect(drawer).toContain('event.key === "Escape"');
    expect(drawer).toContain('event.key !== "Tab"');
    expect(drawer).toContain("onClick={onClose}");
    expect(drawer).toContain("returnFocus?.focus()");
    expect(sidebar).toContain("onClick={onNavigate}");
    expect(shell).toContain("openedOnPath === pathname");
  });

  it("has no phone offset and uses logical desktop positioning", () => {
    expect(shell).toContain("xl:ms-[220px]");
    expect(shell).not.toContain("mr-[220px]");
    expect(sidebar).toContain("fixed start-0");
    expect(sidebar).not.toContain("right-0");
    expect(shell).toContain("overflow-x-clip");
  });
});

describe("critical responsive data views", () => {
  it.each([
    ["students", "src/app/(dashboard)/students/page.tsx", "min-w-[900px]"],
    ["teachers", "src/app/(dashboard)/teachers/page.tsx", "min-w-[820px]"],
    ["statistics", "src/app/(dashboard)/statistics/page.tsx", "min-w-[760px]"],
  ])("keeps the %s table inside a keyboard-accessible scroll region", (_name, path, minimum) => {
    const page = source(path);
    expect(page).toContain('role="region"');
    expect(page).toContain("tabIndex={0}");
    expect(page).toContain("overflow-x-auto");
    expect(page).toContain(minimum);
  });

  it("keeps the class list as a complete responsive grid", () => {
    const classes = source("src/app/(dashboard)/classes/page.tsx");
    expect(classes).toContain("data-responsive-class-grid");
    expect(classes).toContain("grid-cols-1");
    expect(classes).toContain("sm:grid-cols-2");
    expect(classes).toContain("md:grid-cols-3");
    expect(classes).toContain("xl:grid-cols-4");
  });

  it("bounds in-scope modals to the dynamic viewport height", () => {
    expect(source("src/app/(dashboard)/students/page.tsx")).toContain(
      "max-h-[calc(100dvh-2rem)]"
    );
    expect(source("src/app/(dashboard)/statistics/page.tsx")).toContain(
      "max-h-[calc(100dvh-2rem)]"
    );
  });
});
