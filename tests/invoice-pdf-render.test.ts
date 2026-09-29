import { describe, expect, it } from "vitest";
import { decodeStoredInvoicePdf, renderStoredInvoicePdf } from "@/lib/invoice-pdf";

const school = {
  name: "حضانة الاختبار",
  commercialRegistration: "1234567890",
  vatNumber: "310000000000003",
  contactNumber: "0500000000",
  email: "test@example.com",
  address: "الرياض",
};

describe("temporary invoice PDF rendering", () => {
  it("accepts only valid stored PDF data URIs", () => {
    const valid = `data:application/pdf;base64,${Buffer.from("%PDF-test").toString("base64")}`;

    expect(decodeStoredInvoicePdf(valid)?.toString()).toBe("%PDF-test");
    expect(decodeStoredInvoicePdf("data:text/plain;base64,SGVsbG8=")).toBeNull();
    expect(decodeStoredInvoicePdf("data:application/pdf;base64,SGVsbG8=")).toBeNull();
    expect(decodeStoredInvoicePdf(null)).toBeNull();
  });

  it.each([
    {
      type: "STUDENT" as const,
      data: {
        studentName: "طفل تجريبي",
        guardianName: "ولي أمر تجريبي",
        monthlyFee: "299",
        lateHours: 1,
        lateFee: "10",
        issueDate: "2026-09-01",
      },
    },
    {
      type: "TEACHER" as const,
      data: {
        teacherName: "موظفة تجريبية",
        monthlySalary: "4000",
        lateHours: 2,
        lateDeduction: "40",
        issueDate: "2026-09-01",
      },
    },
  ])("renders a disposable $type invoice from its stored snapshot", async ({ type, data }) => {
    const buffer = await renderStoredInvoicePdf({
      id: `invoice-${type.toLowerCase()}`,
      type,
      amount: type === "STUDENT" ? 309 : 3960,
      vatAmount: type === "STUDENT" ? 40.3 : 0,
      createdAt: new Date("2026-09-01T08:00:00.000Z"),
      data,
      school,
    });

    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(buffer.byteLength).toBeGreaterThan(1_000);
  }, 20_000);
});
