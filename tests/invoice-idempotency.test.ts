import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INVOICE_GENERATION_LEASE_MS,
  idempotencyConflictResponse,
  invoiceGenerationLeaseExpiry,
  invoiceRequestHash,
  missingIdempotencyKeyResponse,
  readIdempotencyKey,
} from "@/lib/invoice-idempotency";

describe("invoice idempotency contract", () => {
  it("requires a bounded safe key", async () => {
    expect(readIdempotencyKey(new Request("http://localhost", { headers: { "Idempotency-Key": "invoice:12345678" } }))).toBe("invoice:12345678");
    expect(readIdempotencyKey(new Request("http://localhost", { headers: { "Idempotency-Key": "short" } }))).toBeNull();
    const response = missingIdempotencyKeyResponse();
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
  });

  it("hashes canonical payloads consistently and distinguishes changes", () => {
    expect(invoiceRequestHash({ b: 2, a: 1 })).toBe(invoiceRequestHash({ a: 1, b: 2 }));
    expect(invoiceRequestHash({ amount: "10.00" })).not.toBe(invoiceRequestHash({ amount: "11.00" }));
  });

  it("returns a retry hint while a matching operation is pending", async () => {
    const response = idempotencyConflictResponse("IN_PROGRESS");
    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("2");
    await expect(response.json()).resolves.toMatchObject({ code: "IN_PROGRESS" });
  });

  it("uses a bounded recovery lease for an interrupted generator", () => {
    const now = new Date("2026-08-14T00:00:00.000Z");
    expect(invoiceGenerationLeaseExpiry(now).getTime() - now.getTime()).toBe(INVOICE_GENERATION_LEASE_MS);
    expect(INVOICE_GENERATION_LEASE_MS).toBe(10 * 60 * 1000);
  });

  it("keeps incomplete operation rows out of invoice reads and totals", () => {
    const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    for (const path of [
      "src/app/api/invoices/route.ts",
      "src/app/api/invoices/[id]/route.ts",
      "src/app/api/mobile/v1/invoices/route.ts",
      "src/lib/finance.ts",
    ]) {
      expect(source(path)).toContain('generationStatus: "COMPLETED"');
    }
    expect(source("src/app/api/admin/invoices/[school_id]/route.ts")).toContain('generation_status: "COMPLETED"');
  });

  it("keeps one client idempotency key for each mounted invoice form", () => {
    for (const path of [
      "src/components/students/InvoiceModal.tsx",
      "src/components/teachers/TeacherInvoiceModal.tsx",
      "src/components/admin/AdminInvoiceModal.tsx",
    ]) {
      const code = readFileSync(join(process.cwd(), path), "utf8");
      expect(code).toMatch(/useState\(\(\) => createIdempotencyKey\(/);
      expect(code).toContain('"Idempotency-Key": idempotencyKey');
    }
  });
});
