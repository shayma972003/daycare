import { describe, expect, it } from "vitest";
import { bulkSummary } from "@/lib/bulk-result";

describe("bulk operation result contract", () => {
  it("reports partial outcomes without claiming total success", () => {
    expect(bulkSummary([
      { id: "a", status: "succeeded" },
      { id: "b", status: "failed", code: "NOT_FOUND" },
      { id: "c", status: "skipped", code: "ALREADY_DONE" },
    ])).toEqual({
      requested: 3,
      succeeded: 1,
      failed: 1,
      skipped: 1,
      results: [
        { id: "a", status: "succeeded" },
        { id: "b", status: "failed", code: "NOT_FOUND" },
        { id: "c", status: "skipped", code: "ALREADY_DONE" },
      ],
    });
  });
});
