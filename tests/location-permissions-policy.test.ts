import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("location permissions policy", () => {
  it("allows geolocation only for the application's own origin", () => {
    const config = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");

    expect(config).toContain("geolocation=(self)");
    expect(config).not.toContain("geolocation=()");
    expect(config).not.toContain("geolocation=*");
  });
});
