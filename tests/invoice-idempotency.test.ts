import { describe, expect, it } from "vitest";
import {
  idempotencyConflictResponse,
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
});
