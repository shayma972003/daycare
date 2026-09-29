import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  sessionErrorResponse: vi.fn(),
  findFirst: vi.fn(),
  decodeStoredInvoicePdf: vi.fn(),
  renderStoredInvoicePdf: vi.fn(),
  logSafeError: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: mocks.sessionErrorResponse,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findFirst: mocks.findFirst } },
}));

vi.mock("@/lib/student-access-scope", () => ({
  scopedClassIds: () => null,
  studentClassWhere: () => ({}),
}));

vi.mock("@/lib/invoice-pdf", () => ({
  decodeStoredInvoicePdf: mocks.decodeStoredInvoicePdf,
  renderStoredInvoicePdf: mocks.renderStoredInvoicePdf,
}));

vi.mock("@/lib/safe-logger", () => ({
  logSafeError: mocks.logSafeError,
}));

import { GET } from "@/app/api/invoices/[id]/pdf/route";

const invoice = {
  id: "invoice-123456789",
  type: "STUDENT" as const,
  amount: 299,
  vat_amount: 39,
  pdfUrl: null,
  data: { studentName: "طفل تجريبي", monthlyFee: "299" },
  createdAt: new Date("2026-09-01T08:00:00.000Z"),
  school: {
    name: "حضانة الاختبار",
    commercialRegistration: null,
    vatNumber: null,
    contactNumber: null,
    email: null,
    address: null,
  },
};

async function download(disposition = "attachment") {
  return GET(
    new Request(`http://localhost/api/invoices/${invoice.id}/pdf?disposition=${disposition}`),
    { params: Promise.resolve({ id: invoice.id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ user: { schoolId: "school-1" }, teacherId: null });
  mocks.sessionErrorResponse.mockReturnValue(null);
  mocks.findFirst.mockResolvedValue(invoice);
  mocks.decodeStoredInvoicePdf.mockReturnValue(null);
  mocks.renderStoredInvoicePdf.mockResolvedValue(Buffer.from("%PDF-regenerated"));
});
describe("invoice PDF download", () => {
  it("regenerates a missing PDF in memory without a database write", async () => {
    const response = await download();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-regenerated");
    expect(mocks.renderStoredInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({
      id: invoice.id,
      type: "STUDENT",
      amount: 299,
      vatAmount: 39,
      data: invoice.data,
    }));
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: invoice.id,
        schoolId: "school-1",
        generationStatus: "COMPLETED",
      }),
    }));
  });

  it("streams an existing valid PDF without regenerating it", async () => {
    const stored = Buffer.from("%PDF-stored");
    mocks.decodeStoredInvoicePdf.mockReturnValue(stored);

    const response = await download("inline");

    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(stored);
    expect(mocks.renderStoredInvoicePdf).not.toHaveBeenCalled();
  });

  it("does not expose an invoice outside the scoped query", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await download();

    expect(response.status).toBe(404);
    expect(mocks.renderStoredInvoicePdf).not.toHaveBeenCalled();
  });

  it("returns a safe error when temporary rendering fails", async () => {
    mocks.renderStoredInvoicePdf.mockRejectedValue(new Error("renderer failed"));

    const response = await download();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "تعذر تجهيز ملف الفاتورة" });
    expect(mocks.logSafeError).toHaveBeenCalledWith("invoice-pdf-download", expect.any(Error));
  });
});
