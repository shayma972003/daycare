export type BulkItemResult = {
  id: string;
  status: "succeeded" | "failed" | "skipped";
  code?: string;
};

export function bulkSummary(results: BulkItemResult[]) {
  return {
    requested: results.length,
    succeeded: results.filter((item) => item.status === "succeeded").length,
    failed: results.filter((item) => item.status === "failed").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    results,
  };
}
