import { describe, expect, it, vi } from "vitest";
import { DataErrorState } from "@/components/ui/DataLoadState";
import {
  collectionView,
  countedBulkOutcome,
  exactBulkOutcome,
} from "@/lib/collection-state";

describe("collection states", () => {
  it("keeps initial error distinct from a successful empty result", () => {
    expect(collectionView("error", 0)).toBe("error");
    expect(collectionView("ready", 0)).toBe("empty");
    expect(collectionView("loading", 0)).toBe("loading");
    expect(collectionView("error", 2)).toBe("content");
  });

  it("connects the visible error action to Retry", () => {
    const retry = vi.fn();
    const state = DataErrorState({ message: "failed", retryLabel: "Retry", onRetry: retry });
    const children = state.props.children as React.ReactElement[];
    const retryButton = children[1] as React.ReactElement<{
      children: React.ReactNode;
      onClick: () => void;
    }>;

    expect(retryButton.props.children).toBe("Retry");
    retryButton.props.onClick();
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("bulk outcomes", () => {
  it("retains only exact failed items when every item has a result", () => {
    expect(exactBulkOutcome(["a", "b", "c"], [true, false, true])).toEqual({
      succeeded: 2,
      failed: 1,
      remainingSelection: ["b"],
      exactFailures: true,
    });
  });

  it("retains the full selection for a count-only partial response", () => {
    expect(countedBulkOutcome(["a", "b", "c"], 2)).toEqual({
      succeeded: 2,
      failed: 1,
      remainingSelection: ["a", "b", "c"],
      exactFailures: false,
    });
  });
});
