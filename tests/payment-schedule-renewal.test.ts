import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { generatePaymentCycles } from "@/lib/payment-cycles";

const mocks = vi.hoisted(() => ({ findStudent: vi.fn(), findCycles: vi.fn(), create: vi.fn(), remove: vi.fn(), settings: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
const tx = {
  student: { findUnique: mocks.findStudent }, settings: { findUnique: mocks.settings },
  paymentCycle: { findMany: mocks.findCycles, createMany: mocks.create, deleteMany: mocks.remove },
} as unknown as Prisma.TransactionClient;
const daily = { id: "s", schoolId: "school", enrollment_date: new Date("2024-01-01"), enrollmentEndDate: new Date("2026-12-31"), billingCycle: "DAILY", cycleFee: 10, billingIntervalDays: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findStudent.mockResolvedValue(daily);
  mocks.findCycles.mockResolvedValue([]);
  mocks.settings.mockResolvedValue({ monthlyStudentFee: 100 });
  mocks.create.mockResolvedValue({ count: 1 });
  mocks.remove.mockResolvedValue({ count: 1 });
});
const written = () => mocks.create.mock.calls.flatMap(([arg]) => arg.data as Prisma.PaymentCycleCreateManyInput[]);

describe("untruncated schedules and non-destructive renewal", () => {
  it("uses the configured daily rate for both creation and renewal when no student override exists", async () => {
    mocks.findStudent.mockResolvedValue({ ...daily, cycleFee: null, enrollment_date: new Date("2026-08-27"), enrollmentEndDate: new Date("2026-08-27") });
    mocks.settings.mockResolvedValue({ dailyStudentFee: "42.50", monthlyStudentFee: 500 });
    await generatePaymentCycles("s", tx);
    expect(written()).toHaveLength(1);
    expect(String(written()[0].amount)).toBe("42.5");
    expect(mocks.settings).toHaveBeenCalledWith({ where: { schoolId: "school" }, select: { dailyStudentFee: true, monthlyStudentFee: true } });
  });
  it("generates every daily cycle across three years in batches, including leap day", async () => {
    await generatePaymentCycles("s", tx);
    expect(written()).toHaveLength(1096);
    expect(mocks.create.mock.calls.map(([arg]) => arg.data.length)).toEqual([500, 500, 96]);
    expect(written().at(-1)?.due_date).toEqual(new Date("2026-12-31"));
    expect(written().filter((c) => new Date(c.due_date).toISOString().startsWith("2024-02-29"))).toHaveLength(1);
  });
  it("keeps paid, cancelled and outstanding history untouched when renewing after a gap", async () => {
    mocks.findStudent.mockResolvedValue({ ...daily, enrollment_date: new Date("2026-08-27"), enrollmentEndDate: new Date("2026-08-28") });
    mocks.findCycles.mockResolvedValue([
      { id: "paid", cycle_number: 1, status: "PAID", due_date: new Date("2026-08-01") },
      { id: "debt", cycle_number: 2, status: "OVERDUE", due_date: new Date("2026-08-02") },
      { id: "cancelled", cycle_number: 3, status: "CANCELLED", due_date: new Date("2026-08-03") },
    ]);
    await generatePaymentCycles("s", tx, new Date("2026-08-27"));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(written().map((c) => c.due_date)).toEqual([new Date("2026-08-27"), new Date("2026-08-28")]);
    expect(written().map((c) => c.cycle_number)).toEqual([4, 5]);
    expect(written().every((c) => c.status === "PENDING")).toBe(true);
  });
  it("keeps a monthly anchor when extending, rather than billing another month mid-cycle", async () => {
    mocks.findStudent.mockResolvedValue({ ...daily, billingCycle: "MONTHLY", enrollment_date: new Date("2026-01-31"), enrollmentEndDate: new Date("2026-03-31") });
    await generatePaymentCycles("s", tx, new Date("2026-02-16"));
    expect(written().map((c) => c.due_date)).toEqual([new Date("2026-02-28"), new Date("2026-03-31")]);
  });
  it("matches existing payments by date, not reused cycle numbers, on retry", async () => {
    mocks.findStudent.mockResolvedValue({ ...daily, enrollment_date: new Date("2026-08-27"), enrollmentEndDate: new Date("2026-08-27") });
    mocks.findCycles.mockResolvedValue([{ id: "existing", cycle_number: 99, status: "PENDING", due_date: new Date("2026-08-27") }]);
    await generatePaymentCycles("s", tx, new Date("2026-08-27"));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not invent fees for a free or unpriced subscription", async () => {
    mocks.findStudent.mockResolvedValue({ ...daily, cycleFee: 0 });
    await generatePaymentCycles("s", tx);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
