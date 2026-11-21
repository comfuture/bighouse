// Reconciles the client's local menu dialog state with the server's inMenu flag
// across page refreshes, WebSocket reconnects, and dropped offline transitions.
export function createMenuModeSync() {
  let serverKnown: boolean | null = null;
  let lastSentAt = 0;

  return {
    observeServer(inMenu: boolean): void {
      serverKnown = Boolean(inMenu);
    },
    markSent(now: number): void {
      lastSentAt = now;
    },
    shouldResync(opts: {
      connected: boolean;
      desired: boolean;
      now: number;
      force?: boolean;
      minIntervalMs?: number;
    }): boolean {
      if (!opts.connected) return false;
      const mismatch = serverKnown !== null ? serverKnown !== opts.desired : opts.desired;
      if (!mismatch) return false;
      if (opts.force) return true;
      const minInterval = opts.minIntervalMs ?? 250;
      return opts.now - lastSentAt >= minInterval;
    }
  };
}
