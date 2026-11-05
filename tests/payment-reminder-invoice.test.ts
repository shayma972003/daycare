import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("payment reminder invoice delivery", () => {
  it("reuses or creates the current monthly invoice and renders a private PDF", () => {
    const helper = source("src/lib/student-invoice-reminder.ts");
    expect(helper).toContain("findInvoiceThisMonth");
    expect(helper).toContain('import("@/app/api/students/[id]/invoice/route")');
    expect(helper).toContain("decodeStoredInvoicePdf");
    expect(helper).toContain("renderStoredInvoicePdf");
    expect(helper).toContain('generationStatus: "COMPLETED"');
  });

  it("attaches the invoice to individual, bulk and assistant payment reminders", () => {
    const individual = source("src/app/api/students/[id]/reminder/route.ts");
    const bulk = source("src/app/api/reminders/route.ts");
    const assistant = source("src/lib/assistant/actions.ts");

    for (const file of [individual, bulk, assistant]) {
      expect(file).toContain("studentInvoiceReminderAttachment");
      expect(file).toContain("تم إرفاق فاتورة هذا الشهر بصيغة PDF");
      expect(file).toContain(".attachment");
    }
    expect(bulk).toContain('parsed.data.kind === "payment"');
  });
});
