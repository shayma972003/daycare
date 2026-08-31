import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { renewStudentSubscription } from "@/lib/student-renewal";
import { POST as renew } from "@/app/api/students/[id]/renew/route";
import { POST as bulkRenew } from "@/app/api/students/bulk-extend/route";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), audit: vi.fn(), session: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session, sessionErrorResponse: () => null }));
function fixture() {
  return { id: "s", name: "Test student", schoolId: "school", deletedAt: null as Date | null, anonymizedAt: null as Date | null,
    isActive: true, status: "ACTIVE", paymentStatus: "PAID", leftAt: null as Date | null, retentionUntil: null as Date | null,
    enrollment_date: new Date("2026-08-01"), enrollmentEndDate: new Date("2026-08-10"), billingCycle: "DAILY", billingIntervalDays: null as number | null, cycleFee: 10 as number | null };
}
let student = fixture();
let cycles: Array<Prisma.PaymentCycleCreateManyInput & { id: string }> = [];
const context = () => ({ id: "s", schoolId: "school", actor: "manager", request: new Request("http://localhost/renew") });
const input = { enrollmentEndDate: "2026-08-28" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-27T09:00:00Z"));
  student = fixture(); cycles = [];
  mocks.audit.mockResolvedValue({}); mocks.lock.mockResolvedValue([{ id: "s" }]);
  mocks.settings.mockResolvedValue({ monthlyStudentFee: 100 });
  mocks.session.mockResolvedValue({ user: { schoolId: "school", name: "manager" }, can: () => true });
  const tx = {
    $queryRaw: mocks.lock,
    student: {
      findFirst: async ({ where }: { where: { id: string; schoolId: string } }) =>
        where.id === student.id && where.schoolId === student.schoolId && !student.deletedAt ? { ...student } : null,
      findUnique: async () => ({ ...student }),
      update: async ({ data }: { data: Partial<typeof student> }) => { student = { ...student, ...data }; return { ...student }; },
    },
    settings: { findUnique: mocks.settings },
    paymentCycle: {
      findMany: async () => cycles.slice(),
      createMany: async ({ data }: { data: Prisma.PaymentCycleCreateManyInput[] }) => {
        for (const row of data) cycles.push({ ...row, id: `cycle-${cycles.length + 1}` });
        return { count: data.length };
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => { cycles = cycles.filter((c) => !where.id.in.includes(c.id)); },
    },
    activityLog: { create: mocks.audit },
  };
  // Transaction harness only, not a claim about real PostgreSQL locking.
  let tail = Promise.resolve();
  mocks.transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const beforeStudent = { ...student }, beforeCycles = cycles.slice();
    try { return await fn(tx); }
    catch (error) { student = beforeStudent; cycles = beforeCycles; throw error; }
    finally { release(); }
  });
});
afterEach(() => vi.useRealTimers());

describe("student renewal transaction", () => {
  it("inherits the daily price from this tenant's settings and returns the saved subscription dates/type", async () => {
    student.cycleFee = null;
    mocks.settings.mockResolvedValue({ dailyStudentFee: "35.50", monthlyStudentFee: 500 });
    const response = await renew(request({ mode: "automatic" }), { params: Promise.resolve({ id: "s" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ student: { enrollmentDate: "2026-08-27T00:00:00.000Z", enrollmentEndDate: "2026-08-27T00:00:00.000Z", billingCycle: "DAILY", paymentStatus: "PENDING", cycleFee: null } });
    expect(cycles).toHaveLength(1);
    expect(String(cycles[0].amount)).toBe("35.5");
    expect(mocks.settings.mock.calls.every(([arg]) => arg.where.schoolId === "school")).toBe(true);
    expect(student.cycleFee).toBeNull(); // Keep inheritance, not a frozen override.
  });
  it("uses an explicit free student price instead of the school's nonzero daily price", async () => {
    student.cycleFee = 0;
    mocks.settings.mockResolvedValue({ dailyStudentFee: 50, monthlyStudentFee: 500 });
    await renewStudentSubscription({ mode: "automatic" }, context());
    expect(cycles).toHaveLength(0);
  });
  it.each(["DAILY", "MONTHLY", "YEARLY"])("automatically renews the saved %s period, with exactly one due and no duplicate on retry", async (cycle) => {
    student.billingCycle = cycle;
    const body = { mode: "automatic" as const };
    await Promise.all([renewStudentSubscription(body, context()), renewStudentSubscription(body, context())]);
    expect(cycles).toHaveLength(1);
    expect(student.enrollment_date).toEqual(new Date("2026-08-27"));
    expect(student.paymentStatus).toBe("PENDING");
    student.paymentStatus = "PAID";
    await renewStudentSubscription(body, context());
    expect(student.paymentStatus).toBe("PAID");
    expect(cycles).toHaveLength(1);
  });
  it("computes today on the server from the device zone, ignoring a supplied automatic end date", async () => {
    vi.setSystemTime(new Date("2026-08-27T22:00:00Z"));
    await renewStudentSubscription({ mode: "automatic", enrollmentEndDate: "2030-01-01", billingCycle: "YEARLY" }, {
      ...context(), request: new Request("https://example.invalid", { headers: { "X-Time-Zone": "Asia/Tokyo" } }),
    });
    expect(student.enrollment_date).toEqual(new Date("2026-08-28"));
    expect(student.enrollmentEndDate).toEqual(new Date("2026-08-28"));
    expect(student.billingCycle).toBe("DAILY");
  });
  it("rejects invalid device zones before opening any transaction", async () => {
    await expect(renewStudentSubscription({ mode: "automatic" }, { ...context(), request: new Request("https://example.invalid", { headers: { "X-Time-Zone": "invalid" } }) })).rejects.toMatchObject({ code: "INVALID_TIME_ZONE" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("renews an expired daily subscription today without billing the gap or settling debts", async () => {
    cycles = [{ id: "old", school_id: "school", student_id: "s", due_date: new Date("2026-08-01"), amount: 10, status: "OVERDUE", cycle_number: 1 }];
    await renewStudentSubscription(input, context());
    expect(student.enrollment_date).toEqual(new Date("2026-08-27"));
    expect(cycles.map((c) => c.due_date)).toEqual([new Date("2026-08-01"), new Date("2026-08-27"), new Date("2026-08-28")]);
    expect(cycles[0].status).toBe("OVERDUE");
    expect(cycles.slice(1).every((c) => c.status === "PENDING")).toBe(true);
    expect(student.paymentStatus).toBe("PENDING");
    expect(mocks.lock.mock.calls[0][0].strings.join("?")).toContain("FOR UPDATE");
  });
  it.each(["WITHDRAWN", "GRADUATED", "TRANSFERRED"])("requires consent to renew %s and clears the retention deadline on return", async (status) => {
    Object.assign(student, { isActive: false, status, paymentStatus: "CANCELLED", leftAt: new Date("2026-08-10"), retentionUntil: new Date("2031-08-10") });
    await expect(renewStudentSubscription(input, context())).rejects.toMatchObject({ code: "REACTIVATION_REQUIRED" });
    expect(student.isActive).toBe(false); expect(cycles).toHaveLength(0);
    await renewStudentSubscription({ ...input, reactivate: true }, context());
    expect(student).toMatchObject({ isActive: true, status: "ACTIVE", leftAt: null, retentionUntil: null, paymentStatus: "PENDING" });
  });
  it("also requires consent for a manually suspended payment status on an active record", async () => {
    student.paymentStatus = "SUSPENDED";
    await expect(renewStudentSubscription(input, context())).rejects.toMatchObject({ code: "REACTIVATION_REQUIRED" });
    await renewStudentSubscription({ ...input, reactivate: true }, context());
    expect(student.paymentStatus).toBe("PENDING");
  });
  it("allows same-day daily renewal and repeated renewals in later days", async () => {
    await renewStudentSubscription({ enrollmentEndDate: "2026-08-27" }, context());
    vi.setSystemTime(new Date("2026-09-05T09:00:00Z"));
    await renewStudentSubscription({ enrollmentEndDate: "2026-09-05" }, context());
    expect(cycles.map((c) => c.due_date)).toEqual([new Date("2026-08-27"), new Date("2026-09-05")]);
  });
  it("does not duplicate cycles under a serialized concurrent retry", async () => {
    await Promise.all([renewStudentSubscription(input, context()), renewStudentSubscription(input, context())]);
    expect(cycles).toHaveLength(2);
  });
  it("rolls back reactivation, dates and payments when the audit fails", async () => {
    student.isActive = false;
    const original = { ...student };
    mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(renewStudentSubscription({ ...input, reactivate: true }, context())).rejects.toThrow();
    expect(student).toEqual(original); expect(cycles).toEqual([]);
  });
  it.each(["deletedAt", "anonymizedAt"] as const)("does not restore %s records through renewal", async (field) => {
    student[field] = new Date();
    await expect(renewStudentSubscription({ ...input, reactivate: true }, context())).rejects.toMatchObject({ code: field === "deletedAt" ? "NOT_FOUND" : "ANONYMIZED_STUDENT" });
    expect(cycles).toHaveLength(0);
  });
  it("rejects a different tenant and invalid or shortening dates", async () => {
    await expect(renewStudentSubscription(input, { ...context(), schoolId: "other" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(renewStudentSubscription({ enrollmentEndDate: "2026-08-26" }, context())).rejects.toMatchObject({ code: "INVALID_RENEWAL_DATE" });
    student.enrollmentEndDate = new Date("2026-09-30");
    await expect(renewStudentSubscription(input, context())).rejects.toMatchObject({ code: "RENEWAL_CANNOT_SHORTEN" });
  });
  it("rejects unpriced daily subscriptions, but allows explicit free subscriptions", async () => {
    student.cycleFee = null;
    await expect(renewStudentSubscription(input, context())).rejects.toMatchObject({ code: "CYCLE_FEE_REQUIRED" });
    await renewStudentSubscription({ ...input, cycleFee: 0 }, context());
    expect(student.enrollmentEndDate).toEqual(new Date(input.enrollmentEndDate));
    expect(cycles).toHaveLength(0);
  });
});

const request = (body: unknown) => new Request("http://localhost/renew", { method: "POST", body: JSON.stringify(body) });
describe("single and bulk API contracts", () => {
  it("returns a clear consent error without changing a stopped student", async () => {
    student.isActive = false;
    const response = await renew(request(input), { params: Promise.resolve({ id: "s" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "REACTIVATION_REQUIRED" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("deduplicates bulk ids and reports individual failures", async () => {
    const response = await bulkRenew(request({ ...input, ids: ["s", "s", "other"] }));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ updated: 1, requested: 2, failed: 1, results: [{ id: "s", status: "succeeded" }, { id: "other", status: "failed", code: "NOT_FOUND" }] });
    expect(cycles).toHaveLength(2);
  });
  it("refuses unauthorized and malformed requests before opening a transaction", async () => {
    mocks.session.mockResolvedValueOnce({ user: { schoolId: "school" }, can: () => false });
    expect((await bulkRenew(request({ ...input, ids: ["s"] }))).status).toBe(403);
    const invalid = await renew(request({ enrollmentEndDate: "2026-02-30" }), { params: Promise.resolve({ id: "s" }) });
    expect(invalid.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
