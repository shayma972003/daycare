import { describe, it, expect } from "vitest";
import ar from "../locales/ar.json";
import en from "../locales/en.json";
import { translate } from "@/lib/i18n";

/**
 * Guards the two failures this file exists because of.
 *
 * The first: a key present in one dictionary and absent from the other. English
 * silently falls back to Arabic, so the gap does not throw — it shows up as four
 * Arabic words in the middle of an English menu, and only when somebody switches
 * language and looks.
 *
 * The second: a placeholder that does not survive translation. `{count}` written
 * in Arabic and forgotten in English produces a sentence with a number missing
 * from it, which reads as a finished sentence.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") flat.set(path, value);
    else for (const [k, v] of flatten(value, path)) flat.set(k, v);
  }
  return flat;
}

const arabic = flatten(ar as Tree);
const english = flatten(en as Tree);

const placeholders = (value: string) =>
  new Set(Array.from(value.matchAll(/\{(\w+)\}/g), (m) => m[1]));

describe("the two dictionaries agree", () => {
  it("has an English string for every Arabic key", () => {
    const missing = [...arabic.keys()].filter((key) => !english.has(key));
    expect(missing).toEqual([]);
  });

  it("has an Arabic string for every English key", () => {
    const missing = [...english.keys()].filter((key) => !arabic.has(key));
    expect(missing).toEqual([]);
  });

  it("uses the same placeholders in both languages", () => {
    const mismatched: string[] = [];
    for (const [key, arValue] of arabic) {
      const enValue = english.get(key);
      if (!enValue) continue;
      const a = placeholders(arValue);
      const e = placeholders(enValue);
      if (a.size !== e.size || [...a].some((name) => !e.has(name))) {
        mismatched.push(`${key}: ar{${[...a]}} vs en{${[...e]}}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("leaves no string empty", () => {
    const blank = [...arabic, ...english]
      .filter(([, value]) => value.trim() === "")
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });
});

describe("translate", () => {
  it("returns the requested language", () => {
    expect(translate("en", "nav.students")).toBe("Students");
    expect(translate("ar", "nav.students")).toBe("الطلاب");
  });

  it("covers the nav entries that were left as Arabic literals", () => {
    for (const key of ["care", "calendar", "units", "shifts"]) {
      expect(translate("en", `nav.${key}`)).toMatch(/^[A-Za-z ]+$/);
    }
  });

  it("substitutes placeholders", () => {
    expect(translate("en", "home.ofExpected", { total: 12 })).toBe("of 12 expected");
    expect(translate("ar", "home.ofExpected", { total: 12 })).toBe("من 12 متوقع");
  });

  it("leaves an unknown placeholder visible rather than blank", () => {
    // A gap in a sentence is easy to miss; `{total}` on screen is not.
    expect(translate("en", "home.ofExpected", {})).toContain("{total}");
  });

  it("falls back to Arabic, then to the key itself", () => {
    expect(translate("en", "nothing.here.at.all")).toBe("nothing.here.at.all");
  });
});
