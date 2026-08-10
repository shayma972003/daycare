export type CollectionStatus = "loading" | "refreshing" | "ready" | "error";
export type CollectionView = "loading" | "error" | "empty" | "content";

export function collectionView(status: CollectionStatus, itemCount: number): CollectionView {
  if (itemCount > 0) return "content";
  if (status === "loading" || status === "refreshing") return "loading";
  if (status === "error") return "error";
  return "empty";
}

export interface BulkOutcome {
  succeeded: number;
  failed: number;
  /** Exact failed ids when the API reports per-item results; conservative otherwise. */
  remainingSelection: string[];
  exactFailures: boolean;
}

export function exactBulkOutcome(
  ids: readonly string[],
  succeeded: readonly boolean[]
): BulkOutcome {
  const remainingSelection = ids.filter((_, index) => !succeeded[index]);
  return {
    succeeded: ids.length - remainingSelection.length,
    failed: remainingSelection.length,
    remainingSelection,
    exactFailures: true,
  };
}

/**
 * Count-only endpoints cannot identify which rows failed. On partial success we
 * retain the whole selection rather than clearing an unproven failed subset.
 */
export function countedBulkOutcome(ids: readonly string[], succeeded: number): BulkOutcome {
  const safeSucceeded = Math.max(0, Math.min(ids.length, succeeded));
  const failed = ids.length - safeSucceeded;
  return {
    succeeded: safeSucceeded,
    failed,
    remainingSelection: failed === 0 ? [] : [...ids],
    exactFailures: failed === 0,
  };
}
