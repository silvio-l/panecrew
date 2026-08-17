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
  save: (payload: T) => void,
  scheduler: SessionSaveGateScheduler,
): { request: (payload: T) => void; cancel: () => void } {
  let cancelPending: (() => void) | null = null;
  let latest: { value: T } | null = null;

  const request = (payload: T) => {
    latest = { value: payload };
    cancelPending?.();
    cancelPending = scheduler.schedule(() => {
      cancelPending = null;
      if (latest) save(latest.value);
    });
  };

  /** Discards a still-pending debounced save without applying it — for
   * unmount cleanup, so a timer firing after teardown doesn't write on
   * behalf of a component that's already gone. */
  const cancel = () => {
    cancelPending?.();
    cancelPending = null;
  };

  return { request, cancel };
}
