import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ schoolCreate: vi.fn(), userCreate: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { create: mocks.schoolCreate },
    user: { create: mocks.userCreate },
  },
}));

import { POST } from "@/app/api/auth/register/route";

describe("retired self-registration route", () => {
  it("returns a fixed non-enumerating 410 without parsing or creating data", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "التسجيل العام غير متاح. تُنشأ الحسابات عبر دعوة إدارية آمنة.",
      code: "SELF_REGISTRATION_DISABLED",
    });
    expect(mocks.schoolCreate).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });
});
