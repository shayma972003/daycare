import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  studentFind: vi.fn(),
  settingsFind: vi.fn(),
  schoolFind: vi.fn(),
  invoiceFind: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireSession: mocks.session, sessionErrorResponse: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  student: { findFirst: mocks.studentFind },
  settings: { findUnique: mocks.settingsFind },
  school: { findUnique: mocks.schoolFind },
  invoice: { findUniqueOrThrow: mocks.invoiceFind },
} }));
vi.mock("@/lib/invoice-duplicates", () => ({ findInvoiceThisMonth: () => Promise.resolve(null), duplicateInvoiceResponse: vi.fn() }));
vi.mock("@/lib/invoice-idempotency", () => ({
  readIdempotencyKey: (request: Request) => request.headers.get("Idempotency-Key"),
  missingIdempotencyKeyResponse: () => Response.json({}, { status: 400 }),
  invoiceRequestHash: () => "hash",
  claimInvoice: mocks.claim,
  completeInvoiceClaim: mocks.complete,
  failInvoiceClaim: mocks.fail,
  idempotencyConflictResponse: () => Response.json({}, { status: 409 }),
}));
vi.mock("@/lib/activity-logger", () => ({ logAction: vi.fn() }));

import { POST } from "@/app/api/students/[id]/invoice/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { schoolId: "school-1", name: "Manager" }, can: () => true });
  mocks.studentFind.mockResolvedValue({
    id: "student-1", schoolId: "school-1", name: "Student", billingCycle: "YEARLY", cycleFee: 2400,
    guardian: null, class: null, period: "MORNING",
  });
  mocks.settingsFind.mockResolvedValue({ dailyStudentFee: 10, weeklyStudentFee: 70, monthlyStudentFee: 300, yearlyStudentFee: 3000 });
  mocks.schoolFind.mockResolvedValue({ vatRegistered: false });
  mocks.claim.mockResolvedValue({ state: "claimed", id: "invoice-1", leaseExpiresAt: new Date("2026-09-02") });
  mocks.complete.mockResolvedValue(undefined);
  mocks.fail.mockResolvedValue(undefined);
  mocks.invoiceFind.mockResolvedValue({ id: "invoice-1", amount: 2400 });
});

describe("student invoice subscription pricing", () => {
  it("uses the student's saved cycle snapshot rather than the monthly school fee", async () => {
    const response = await POST(new Request("http://localhost/api/students/student-1/invoice", {
      method: "POST",
      headers: { "Idempotency-Key": "invoice-request-1" },
    }), { params: Promise.resolve({ id: "student-1" }) });
    expect(response.status).toBe(201);
    expect(mocks.complete).toHaveBeenCalledWith("invoice-1", expect.any(Date), expect.objectContaining({
      amount: expect.anything(),
      data: expect.objectContaining({ monthlyFee: "2400.00" }),
    }));
    expect(String(mocks.complete.mock.calls[0][2].amount)).toBe("2400");
  });
});
