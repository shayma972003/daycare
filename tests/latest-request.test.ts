import { describe, expect, it, vi } from "vitest";
import { LatestRequest } from "@/lib/latest-request";

describe("LatestRequest", () => {
  it("does not let an older response overwrite the newest response", () => {
    const requests = new LatestRequest();
    const first = requests.begin();
    const second = requests.begin();
    let value = "initial";

    expect(second.commit(() => { value = "newest"; })).toBe(true);
    expect(first.commit(() => { value = "stale"; })).toBe(false);
    expect(value).toBe("newest");
  });

  it("aborts the previous request when a replacement starts", () => {
    const requests = new LatestRequest();
    const first = requests.begin();
    const abortListener = vi.fn();
    first.signal.addEventListener("abort", abortListener);

    requests.begin();

    expect(first.signal.aborted).toBe(true);
    expect(abortListener).toHaveBeenCalledOnce();
  });

  it("prevents state commits after effect cleanup or unmount", () => {
    const requests = new LatestRequest();
    const effectRequest = requests.begin();
    const update = vi.fn();

    effectRequest.cancel();
    expect(effectRequest.commit(update)).toBe(false);
    expect(update).not.toHaveBeenCalled();

    const mountedRequest = requests.begin();
    requests.dispose();
    expect(mountedRequest.commit(update)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
