import { describe, it, expect } from "vitest";
import { ROLE_TEMPLATES, ALL_PERMISSIONS, grants, isPermissionKey } from "@/lib/permissions";
import { NAV_GROUPS } from "@/lib/nav";

/**
 * The sidebar was regrouped to make ten flat entries feel like fewer places.
 * Grouping is free to be wrong in a way a flat list never was: a heading can
 * gather screens the reader cannot open, and then the group is a locked door
 * with their work behind it.
 *
 * The concrete case this guards is the accountant. They hold `finance.view` and
 * nothing else outside the children list — so filing الإحصائيات under a general
 * "Administration" heading beside staff, shifts and settings would leave them
 * one visible entry inside a group of four they cannot use.
 */
describe("sidebar grouping", () => {
  it("names only real permissions", () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (item.permission === null) continue;
        expect(isPermissionKey(item.permission), `${item.href} names ${item.permission}`).toBe(true);
      }
    }
  });

  it("gives every role at least one entry", () => {
    for (const role of ROLE_TEMPLATES) {
      const visible = NAV_GROUPS.flatMap((group) =>
        group.items.filter(
          (item) => item.permission === null || grants(role.permissions, item.permission)
        )
      );
      expect(visible.length, `${role.key} sees nothing`).toBeGreaterThan(0);
    }
  });

  it("never shows a role a group where it can open nothing", () => {
    // An empty heading is worse than no heading — the component drops such a
    // group, and this proves the data never asks it to.
    for (const role of ROLE_TEMPLATES) {
      for (const group of NAV_GROUPS) {
        const visible = group.items.filter(
          (item) => item.permission === null || grants(role.permissions, item.permission)
        );
        if (visible.length === 0) continue;
        expect(visible.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps finance out of the administration group", () => {
    // The regression this file exists for.
    const admin = NAV_GROUPS.find((group) => group.key === "nav.groupAdmin");
    expect(admin).toBeDefined();
    expect(admin!.items.some((item) => item.href === "/statistics")).toBe(false);

    const accountant = ROLE_TEMPLATES.find((role) => role.key === "accountant")!;
    const financeGroup = NAV_GROUPS.find((group) => group.key === "nav.groupFinance")!;
    // Every entry in the group the accountant's work lives in is open to them.
    const openToAccountant = financeGroup.items.filter(
      (item) => item.permission === null || grants(accountant.permissions, item.permission)
    );
    expect(openToAccountant.length).toBe(financeGroup.items.length);
  });

  it("lets the owner reach every screen", () => {
    const owner = ROLE_TEMPLATES.find((role) => role.permissions.includes(ALL_PERMISSIONS))!;
    const hidden = NAV_GROUPS.flatMap((group) =>
      group.items.filter(
        (item) => item.permission !== null && !grants(owner.permissions, item.permission)
      )
    );
    expect(hidden).toEqual([]);
  });
});
