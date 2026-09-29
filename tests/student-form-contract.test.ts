import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const createPage = readFileSync(
  join(root, "src/app/(dashboard)/students/new/page.tsx"),
  "utf8"
);
const profilePage = readFileSync(
  join(root, "src/app/(dashboard)/students/[id]/page.tsx"),
  "utf8"
);

describe("student form contract", () => {
  it.each([
    ["create", createPage],
    ["profile", profilePage],
  ])("matches the registration guardian fields on %s", (_name, source) => {
    const guardianCard = source.indexOf('studentProfile.guardianInfo');
    const firstGuardian = source.indexOf('studentProfile.firstGuardian');
    const secondGuardian = source.indexOf('studentProfile.secondGuardian');
    const firstSection = source.slice(firstGuardian, secondGuardian);
    const secondSection = source.slice(secondGuardian);

    expect(guardianCard).toBeGreaterThan(-1);
    expect(firstGuardian).toBeGreaterThan(guardianCard);
    expect(secondGuardian).toBeGreaterThan(firstGuardian);
    expect(firstSection).toContain('register("guardianPhone1")');
    expect(firstSection).not.toContain('register("guardianPhone2")');
    expect(secondSection).toContain('register("guardianPhone2")');
    expect(secondSection).not.toContain('register("guardianPhone1")');
    expect(source).toContain('register("guardianEmail2")');
    expect(source).not.toContain('register("guardianPhone3")');
    expect(source).not.toContain('register("guardianPhone4")');
  });

  it.each([
    ["create", createPage],
    ["profile", profilePage],
  ])("keeps the custom price inside the subscription control on %s", (_name, source) => {
    expect(source).toContain('=== "CUSTOM"');
    expect(source).toContain('register("cycleFee")');
    expect(source).toContain('students.customCycleFeeHint');
  });

  it("does not open a stored evaluation URL directly", () => {
    expect(profilePage).toContain('responseType: "blob"');
    expect(profilePage).toContain('/api/students/${id}/evaluation');
    expect(profilePage).not.toContain("window.open(evalFileUrl");
  });
});
