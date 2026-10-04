import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(
  join(process.cwd(), "src/app/api/mobile/v1/messages/route.ts"),
  "utf8"
);

describe("mobile messages", () => {
  it("authenticates both reads and read-state updates", () => {
    expect(route.match(/requireMobileAuth\(request\)/g)).toHaveLength(2);
    expect(route).toContain("export async function GET");
    expect(route).toContain("export async function PATCH");
  });

  it("scopes every recipient operation to the caller and school", () => {
    expect(route).toContain("guardianAccountId: context.claims.sub");
    expect(route).toContain("userId: context.claims.sub");
    expect(route.match(/schoolId: context.schoolId/g)).toHaveLength(2);
    expect(route).toContain("...recipientOwner(context)");
  });

  it("only marks unread rows and accepts a strict optional recipient id", () => {
    expect(route).toContain("patchSchema");
    expect(route).toContain(".strict()");
    expect(route).toContain("readAt: null");
    expect(route).toContain("data: { readAt: new Date() }");
  });
});
