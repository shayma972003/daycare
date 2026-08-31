import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list } from "@/app/api/students/route";
import { GET as tasks } from "@/app/api/dashboard/tasks/route";
const mocks = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session, sessionErrorResponse: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  student: { findMany: mocks.list, count: mocks.count },
  attendance: { count: vi.fn(async () => 0) }, enrollmentSubmission: { count: vi.fn(async () => 0) },
  class: { count: vi.fn(async () => 0) }, careReport: { count: vi.fn(async () => 0) },
  teacher: { count: vi.fn(async () => 0) }, enrollmentToken: { count: vi.fn(async () => 0) },
  school: { findUnique: vi.fn(async () => null) }, $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
} }));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-08-27T22:30:00Z"));
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]); mocks.count.mockResolvedValue(1);
  mocks.session.mockResolvedValue({ user: { schoolId: "tenant-a" }, can: () => true, permissions: ["*"] });
});
afterEach(() => vi.useRealTimers());
const req = (query = "", zone = "Asia/Tokyo") => new Request(`http://localhost/api/students${query}`, { headers: { "X-Time-Zone": zone } });

describe("subscription lists and dashboard alerts", () => {
  it("queries expiry in the device day and retains stopped students in historical lists", async () => {
    expect((await list(req("?subscription=expired"))).status).toBe(200);
    const where = mocks.list.mock.calls[0][0].where;
    expect(where).toMatchObject({ schoolId: "tenant-a", deletedAt: null, enrollmentEndDate: { lt: new Date("2026-08-28") } });
    expect(where).not.toHaveProperty("isActive");
  });
  it("has identical week boundaries and a filtered link in the dashboard", async () => {
    await list(req("?subscription=expiring"));
    const listWhere = mocks.list.mock.calls[0][0].where;
    const response = await tasks(req());
    const body = await response.json();
    expect(body.tasks.find((t: { key: string }) => t.key === "expiringSoon").href).toBe("/students?subscription=expiring");
    expect(body.tasks.find((t: { key: string }) => t.key === "expiredSubscriptions").href).toBe("/students?subscription=expired");
    const weekWhere = mocks.count.mock.calls.map(([call]) => call.where).find((w) => w.enrollmentEndDate?.lt && w.enrollmentEndDate?.gte);
    expect(weekWhere).toEqual(listWhere);
    expect(weekWhere.enrollmentEndDate.lt).toEqual(new Date("2026-09-05"));
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("combines name/class/payment filters without losing current-subscription constraints", async () => {
    await list(req("?subscription=current&search=test&classId=class-a&paymentStatus=PENDING"));
    expect(mocks.list.mock.calls[0][0].where).toMatchObject({ schoolId: "tenant-a", classId: "class-a", name: { contains: "test" }, AND: expect.any(Array), OR: [{ enrollmentEndDate: null }, { enrollmentEndDate: { gte: new Date("2026-08-28") } }] });
  });
  it("returns a pending subscription display without exposing finance to an unauthorized role", async () => {
    mocks.list.mockResolvedValue([{ id: "s", name: "Child", schoolId: "tenant-a", enrollmentEndDate: new Date("2026-08-27"), paymentStatus: "PAID", isActive: true, guardian: null, class: null, billingCycle: "MONTHLY" }]);
    const response = await list(req());
    expect((await response.json())[0]).toMatchObject({ paymentStatus: "PENDING", subscriptionExpired: true, billingCycle: "MONTHLY" });
    mocks.session.mockResolvedValue({ user: { schoolId: "tenant-a" }, can: (p: string) => !p.startsWith("finance.") });
    expect((await (await list(req())).json())[0]).not.toHaveProperty("paymentStatus");
  });
  it("rejects invalid zones before querying records", async () => {
    expect((await list(req("", "bogus"))).status).toBe(422);
    expect((await tasks(req("", "bogus"))).status).toBe(422);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.count).not.toHaveBeenCalled();
  });
  it("returns a generic uncached failure when the list query fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.list.mockRejectedValueOnce(new Error("private database diagnostic"));
      const response = await list(req());
      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(await response.json()).toEqual({ error: "Unable to load students" });
      expect(JSON.stringify(log.mock.calls)).not.toContain("private database diagnostic");
    } finally { log.mockRestore(); }
  });
});
