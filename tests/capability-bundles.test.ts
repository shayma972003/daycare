import { describe, it, expect } from "vitest";
import {
  CAPABILITY_BUNDLES,
  keysOutsideBundles,
  PERMISSION_KEYS,
  ROLE_TEMPLATES,
  ALL_PERMISSIONS,
  isPermissionKey,
} from "@/lib/permissions";

/**
 * The simplified permissions view is a *view*. These guard the one way it could
 * quietly do damage.
 *
 * A simple screen that saved what it displayed would drop every key it does not
 * draw. It would not throw, and nobody would notice at the time — the role would
 * simply stop working for whoever held it, days later, on a screen nobody
 * connected to the edit. So the editor keeps the full permission list as its
 * draft and each toggle only adds or removes its own keys.
 */

/** What the editor does when a bundle is switched on and off. */
function toggleOn(draft: string[], keys: string[]): string[] {
  return Array.from(new Set([...draft, ...keys]));
}

function toggleOff(draft: string[], keys: string[]): string[] {
  return draft.filter((key) => !keys.includes(key));
}

describe("capability bundles", () => {
  it("only names permissions that exist", () => {
    // A typo here is a checkbox that appears to work and grants nothing.
    for (const bundle of CAPABILITY_BUNDLES) {
      for (const key of bundle.keys) {
        expect(isPermissionKey(key), `${bundle.key} names unknown permission ${key}`).toBe(true);
      }
    }
  });

  it("never claims two bundles own the same key", () => {
    // Overlap means switching one bundle off silently disables another.
    const seen = new Set<string>();
    for (const bundle of CAPABILITY_BUNDLES) {
      for (const key of bundle.keys) {
        expect(seen.has(key), `${key} appears in more than one bundle`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("preserves permissions it does not display", () => {
    // A role holding a key no bundle covers.
    const uncovered = PERMISSION_KEYS.filter((key) => keysOutsideBundles([key]).length === 1);
    expect(uncovered.length).toBeGreaterThan(0);

    const draft = [uncovered[0], "students.view"];
    const bundle = CAPABILITY_BUNDLES.find((b) => b.key === "viewChildren")!;

    // Switching the one visible capability off must not touch the other key.
    const after = toggleOff(draft, bundle.keys);
    expect(after).toContain(uncovered[0]);
    expect(after).not.toContain("students.view");

    // And back on again.
    const restored = toggleOn(after, bundle.keys);
    expect(restored).toContain(uncovered[0]);
    expect(restored).toContain("students.view");
  });

  it("reports the keys it cannot draw rather than hiding them", () => {
    const covered = CAPABILITY_BUNDLES.flatMap((b) => b.keys);
    expect(keysOutsideBundles(covered)).toEqual([]);

    const withExtra = keysOutsideBundles([...covered, "students.delete"]);
    expect(withExtra).toEqual(["students.delete"]);
  });

  it("does not count the owner wildcard as an uncovered permission", () => {
    // "*" is a sentinel, not a permission — listing it would tell the owner
    // their role holds one mysterious extra key.
    expect(keysOutsideBundles([ALL_PERMISSIONS])).toEqual([]);
  });

  it("draws every seeded role in full", () => {
    // If a shipped role cannot be drawn, the simple view is incomplete the first
    // time anybody opens it — and the "also holds N others" line appears on a
    // role the school never customised, which reads as a fault.
    for (const role of ROLE_TEMPLATES) {
      if (role.permissions.includes(ALL_PERMISSIONS)) continue;
      expect(keysOutsideBundles(role.permissions), `${role.key} has undrawable keys`).toEqual([]);
    }
  });

  it("keeps irreversible permissions out of the simple view", () => {
    // A friendly sentence must never carry the power to destroy a record.
    // Archiving is reversible from the trash and travels with its bundle;
    // deleting is not, and has to be chosen on purpose.
    const covered = new Set(CAPABILITY_BUNDLES.flatMap((b) => b.keys));
    for (const key of PERMISSION_KEYS) {
      if (key.endsWith(".delete")) {
        expect(covered.has(key), `${key} must stay under advanced options`).toBe(false);
      }
    }
  });
});
