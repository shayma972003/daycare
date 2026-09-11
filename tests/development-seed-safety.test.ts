import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("development seed safety", () => {
  it("fails closed before creating a Prisma adapter and allows only an explicitly approved local target", () => {
    const source = readFileSync("prisma/seed.ts", "utf8");
    expect(source).toContain('process.env.ALLOW_DEVELOPMENT_SEED !== "true"');
    expect(source).toContain('["localhost", "127.0.0.1", "::1"]');
    expect(source.indexOf("assertLocalDevelopmentSeed();"))
      .toBeLessThan(source.indexOf("const adapter = new PrismaPg"));
  });
});
