export interface RequestTicket {
  signal: AbortSignal;
  isCurrent: () => boolean;
  commit: (update: () => void) => boolean;
  cancel: () => void;
}

/**
 * Owns one replaceable request for a mounted consumer.
 *
 * Aborting saves work when the transport supports it; the sequence check is the
 * correctness boundary when it does not. A stale response can resolve, but it
 * cannot commit state.
 */
export class LatestRequest {
  private sequence = 0;
  private controller: AbortController | null = null;
  private disposed = false;

  begin(): RequestTicket {
    this.controller?.abort();
    const controller = new AbortController();
    const sequence = ++this.sequence;
    this.controller = controller;

    const isCurrent = () =>
      !this.disposed &&
      this.sequence === sequence &&
      this.controller === controller &&
      !controller.signal.aborted;

    return {
      signal: controller.signal,
      isCurrent,
      commit(update) {
        if (!isCurrent()) return false;
        update();
        return true;
      },
      cancel: () => {
        if (this.sequence !== sequence || this.controller !== controller) return;
        controller.abort();
        this.sequence += 1;
        this.controller = null;
      },
    };
  }

  dispose() {
    this.disposed = true;
    this.sequence += 1;
    this.controller?.abort();
    this.controller = null;
  }
}
