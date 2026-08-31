import { describe, expect, it, vi } from "vitest";
import { updatePaymentStatuses } from "@/lib/payment-status-updater";
const mocks = vi.hoisted(() => ({ update: vi.fn(), cycleUpdate: vi.fn(), lock: vi.fn(), currentCycles: vi.fn(), many: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  paymentCycle: { findMany: async () => [{ id: "old", student_id: "s", school_id: "a", due_date: new Date("2020-01-01"), status: "OVERDUE", student: { enrollment_date: new Date("2026-08-27"), suspension_notified_at: null } }], update: mocks.cycleUpdate },
  student: { updateMany: mocks.many },
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: mocks.lock, student: { findUnique: async () => ({ isActive: true, deletedAt: null, paymentStatus: "PENDING", enrollment_date: new Date("2026-08-27"), enrollmentEndDate: new Date("2026-09-26") }), update: mocks.update }, paymentCycle: { findMany: mocks.currentCycles } }),
} }));
describe("current-period payment rollup", () => {
  it("keeps historical debts but does not suspend a renewed period because of them", async () => {
    mocks.currentCycles.mockResolvedValue([{ status: "PENDING" }]);
    await updatePaymentStatuses("a");
    expect(mocks.cycleUpdate).toHaveBeenCalledWith({ where: { id: "old" }, data: { status: "SUSPENDED" } });
    expect(mocks.currentCycles).toHaveBeenCalledWith({ where: { student_id: "s", due_date: { gte: new Date("2026-08-27"), lte: new Date("2026-09-26") } }, select: { status: true } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "s" }, data: { paymentStatus: "PENDING" } });
    expect(mocks.many).not.toHaveBeenCalled();
    expect(mocks.lock.mock.calls[0][0].strings.join("?")).toContain("FOR UPDATE");
  });
});
