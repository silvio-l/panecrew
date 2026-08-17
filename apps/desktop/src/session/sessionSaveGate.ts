// Debounces session-file writes the same way resizeGate.ts debounces PTY
// column-resize reflows (same module, same reasoning): rapid repeated
// triggers — e.g. fast terminal-tab cycling via number hotkeys — collapse
// into one write after a short trailing window, and the write always uses
// the LATEST payload, never a stale intermediate one a faster subsequent
// trigger already superseded. Unlike resizeGate, there is no "apply
// immediately" branch: every session save goes through the same debounce,
// since (unlike a resize reflow) there is no correctness reason for the
// first trigger in a burst to ever hit disk on its own.
export interface SessionSaveGateScheduler {
  schedule: (run: () => void) => () => void;
}

export function createSessionSaveGate<T>(
  save: (payload: T) => void | Promise<void>,
  scheduler: SessionSaveGateScheduler,
): {
  request: (payload: T) => void;
  cancel: () => void;
  flush: () => void | Promise<void>;
} {
  let cancelPending: (() => void) | null = null;
  let latest: { value: T } | null = null;

  const request = (payload: T) => {
    latest = { value: payload };
    cancelPending?.();
    cancelPending = scheduler.schedule(() => {
      cancelPending = null;
      if (latest) void save(latest.value);
    });
  };

  /** Discards a still-pending debounced save without applying it — for
   * unmount cleanup, so a timer firing after teardown doesn't write on
   * behalf of a component that's already gone. */
  const cancel = () => {
    cancelPending?.();
    cancelPending = null;
  };

  /** Applies a still-pending debounced save immediately instead of waiting
   * out the rest of the debounce window, and returns whatever `save` itself
   * returns so a caller that needs the write to actually land before doing
   * something else (App.tsx's close-confirmation listener, ahead of the
   * IPC round-trip that lets the window actually close) can await it —
   * unmount-cleanup timing alone isn't a reliable signal for "the native
   * window is about to be destroyed" (perf audit ticket 02 review finding).
   * A no-op if nothing is pending. */
  const flush = () => {
    cancelPending?.();
    cancelPending = null;
    if (latest) return save(latest.value);
  };

  return { request, cancel, flush };
}
