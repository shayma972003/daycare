import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verifySupport: vi.fn(), getToken: vi.fn() }));

vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));
vi.mock("@/lib/support-view-token", () => ({
  SUPPORT_VIEW_COOKIE_NAME: "support_view",
  verifySupportViewToken: mocks.verifySupport,
}));

import { proxy } from "@/proxy";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verifySupport.mockResolvedValue({ accessId: "access-1", adminId: "admin-1", schoolId: "school-1" });
});

function request(path: string, method = "GET") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: "support_view=signed-token" },
  });
}

describe("support view edge guard", () => {
  it("blocks every tenant mutation during support view", async () => {
    const response = await proxy(request("/api/students", "POST"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("SUPPORT_READ_ONLY");
  });

  it("blocks sensitive health and care routes even for GET", async () => {
    const response = await proxy(request("/api/care-reports"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("SUPPORT_SENSITIVE_DATA_BLOCKED");

    const childDetail = await proxy(request("/api/students/child-1"));
    expect(childDetail.status).toBe(403);
  });

  it("keeps every dashboard page navigable instead of redirecting to a look-alike dashboard", async () => {
    for (const path of ["/care", "/statistics", "/settings", "/subscription"]) {
      const response = await proxy(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("allows safe read-only tenant routes and the audit endpoint", async () => {
    const safeRead = await proxy(request("/api/classes"));
    const financeSummary = await proxy(request("/api/statistics/dashboard"));
    const auditWrite = await proxy(request("/api/support-presence", "POST"));

    expect(safeRead.status).toBe(200);
    expect(financeSummary.status).toBe(200);
    expect(auditWrite.status).toBe(200);
  });
});
