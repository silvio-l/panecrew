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
): { request: (payload: T) => void; cancel: () => void; flush: () => void } {
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

  /** Applies a still-pending debounced save immediately instead of waiting
   * out the rest of the debounce window — App.tsx's unmount cleanup uses
   * this instead of `cancel()`, so the last state change before a window
   * closes isn't silently dropped just because it landed inside the
   * trailing debounce window (perf audit ticket 02 review finding). A no-op
   * if nothing is pending. */
  const flush = () => {
    cancelPending?.();
    cancelPending = null;
    if (latest) save(latest.value);
  };

  return { request, cancel, flush };
}
