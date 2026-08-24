import { Terminal } from "@xterm/xterm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  committedLineCount,
  disposeTerminalActivity,
  isTabAwaitingAttention,
  markTabViewed,
  reportOutput,
  resetTerminalActivityForTests,
  setActivityIdleMs,
  setActivityLineThreshold,
} from "./terminalActivity";

// committedLineCount() is the part usePtyTerminal.ts actually calls BEFORE
// and AFTER every terminal.write() — tested against a real xterm.js core
// instead of a mock, same approach as ptyResizeFlush.test.ts.

// xterm queries the device pixel ratio via a media query on open; jsdom has
// no matchMedia (same workaround as inlineSuggestion.test.ts).
beforeAll(() => {
  window.matchMedia = (query) =>
    ({
      matches: false,
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});
function makeTerminal(cols = 20, rows = 4): Terminal {
  const container = document.createElement("div");
  document.body.append(container);
  const terminal = new Terminal({ cols, rows, allowProposedApi: true });
  terminal.open(container);
  return terminal;
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

describe("committedLineCount", () => {
  it("grows when a line break commits new line content", async () => {
    const terminal = makeTerminal();
    const before = committedLineCount(terminal);
    await write(terminal, "first line\r\nsecond line\r\n");
    const after = committedLineCount(terminal);
    if (before === null || after === null) {
      throw new Error("expected the normal buffer, not the alternate buffer");
    }
    expect(after).toBeGreaterThan(before);
  });

  it("stays unchanged on a pure in-place redraw (spinner pattern)", async () => {
    const terminal = makeTerminal();
    await write(terminal, "prompt> ");
    const before = committedLineCount(terminal);
    // Carriage return without linefeed: the same line start gets overwritten
    // in place, exactly what an Ink spinner does — precisely the case where
    // a raw character diff would stay "active" forever.
    await write(terminal, "\rprompt> |");
    await write(terminal, "\rprompt> /");
    const after = committedLineCount(terminal);
    expect(after).toBe(before);
  });

  it("returns null in the alternate buffer (fullscreen TUI like vim/htop)", async () => {
    const terminal = makeTerminal();
    await write(terminal, "\x1b[?1049h"); // enter alternate buffer
    expect(committedLineCount(terminal)).toBeNull();
  });
});

// reportOutput/isTabAwaitingAttention: 2026-08-17 rewrite (user bug report:
// activity detection "doesn't work meaningfully", especially inside Claude Code). // brandlint-ok: functional reference to the specific tool tested, not marketing
// Root cause of the detection gap: the previous design (`active`,
// gated purely on committed-line advances) let its liveness timer expire
// during a pure "thinking" phase (spinner-only redraws, no new committed
// line for several seconds — confirmed against a real captured Claude Code // brandlint-ok: functional reference to the specific tool tested, not marketing
// PTY session). `reportOutput` fixes that by treating ANY output as
// liveness, independent of whether it committed a line.
describe("reportOutput / isTabAwaitingAttention", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetTerminalActivityForTests();
    // Module-global thresholds reset — otherwise a threshold set in one test
    // leaks into the next (setActivityIdleMs/setActivityLineThreshold are
    // deliberately module-global, see terminalActivity.ts header comment).
    setActivityIdleMs(1500);
    setActivityLineThreshold(1);
  });

  it("is not awaiting attention before any output was ever reported", () => {
    expect(isTabAwaitingAttention("tab-a")).toBe(false);
  });

  it("consumes only the very first qualifying burst as the boot prompt", () => {
    reportOutput("tab-a", 1);
    vi.advanceTimersByTime(1500);
    // First burst was the boot prompt — no real work yet, so no marker even
    // after going idle.
    expect(isTabAwaitingAttention("tab-a")).toBe(false);

    reportOutput("tab-a", 1);
    vi.advanceTimersByTime(1500);
    // Second burst is real work — now eligible, and idle long enough.
    expect(isTabAwaitingAttention("tab-a")).toBe(true);
  });

  it("does not flag a tab that only ever produced non-committing output (pure redraws)", () => {
    reportOutput("tab-a", 0);
    reportOutput("tab-a", 0);
    vi.advanceTimersByTime(1500);
    expect(isTabAwaitingAttention("tab-a")).toBe(false);
  });

  it("stays busy (not awaiting attention) while output keeps arriving within idleMs", () => {
    reportOutput("tab-a", 1); // boot prompt, consumed
    reportOutput("tab-a", 1); // real work, arms hasBeenActive
    expect(isTabAwaitingAttention("tab-a")).toBe(false);

    vi.advanceTimersByTime(1000);
    reportOutput("tab-a", 0); // pure spinner redraw, no line advance
    vi.advanceTimersByTime(1000);
    // Total elapsed since the last real line advance is 2000ms > idleMs
    // (1500), but the spinner redraw at t=1000ms kept the tab "busy" — this
    // is exactly the root-cause case: a tool still visibly working (via
    // redraws) must not be flagged "done".
    expect(isTabAwaitingAttention("tab-a")).toBe(false);

    vi.advanceTimersByTime(500);
    // Now 1500ms have passed since that last redraw with no further output.
    expect(isTabAwaitingAttention("tab-a")).toBe(true);
  });

  it("clears the marker the instant new output arrives, of any kind", () => {
    reportOutput("tab-a", 1); // boot prompt
    reportOutput("tab-a", 1); // real work
    vi.advanceTimersByTime(1500);
    expect(isTabAwaitingAttention("tab-a")).toBe(true);

    reportOutput("tab-a", 0); // e.g. the agent starts thinking again
    expect(isTabAwaitingAttention("tab-a")).toBe(false);
  });

  it("keeps tabs independent of each other", () => {
    reportOutput("tab-a", 1);
    reportOutput("tab-a", 1);
    reportOutput("tab-b", 1);
    reportOutput("tab-b", 1);
    vi.advanceTimersByTime(1500);
    expect(isTabAwaitingAttention("tab-a")).toBe(true);
    expect(isTabAwaitingAttention("tab-b")).toBe(true);

    reportOutput("tab-a", 1); // only tab-a resumes
    expect(isTabAwaitingAttention("tab-a")).toBe(false);
    expect(isTabAwaitingAttention("tab-b")).toBe(true);
  });

  it("never flags the currently viewed tab, even once it's idle", () => {
    reportOutput("tab-a", 1);
    reportOutput("tab-a", 1);
    markTabViewed("tab-a");
    vi.advanceTimersByTime(1500);
    expect(isTabAwaitingAttention("tab-a")).toBe(false);
  });

  it("flags a tab immediately once the user looks away from it, if it's already idle", () => {
    // Regression coverage for the derived-state design: isTabAwaitingAttention
    // is computed live from (hasBeenActive, busy, viewedTabId), not cached —
    // markTabViewed must re-evaluate the PREVIOUSLY viewed tab, or a tab that
    // finished while being watched would never get a chance to flag itself
    // once the user moves on.
    reportOutput("tab-a", 1);
    reportOutput("tab-a", 1);
    markTabViewed("tab-a");
    vi.advanceTimersByTime(1500); // finishes while still being watched
    expect(isTabAwaitingAttention("tab-a")).toBe(false);

    markTabViewed("tab-b"); // user looks away, no new output on tab-a since
    expect(isTabAwaitingAttention("tab-a")).toBe(true);
  });

  it("markTabViewed clears an already-set marker immediately", () => {
    reportOutput("tab-a", 1);
    reportOutput("tab-a", 1);
    vi.advanceTimersByTime(1500);
    expect(isTabAwaitingAttention("tab-a")).toBe(true);

    markTabViewed("tab-a");
    expect(isTabAwaitingAttention("tab-a")).toBe(false);
  });

  it("setActivityLineThreshold requires the raised line count before a tab counts as having done real work", () => {
    setActivityLineThreshold(3);
    reportOutput("tab-a", 3); // boot prompt, consumed regardless of size
    reportOutput("tab-a", 1);
    reportOutput("tab-a", 1);
    vi.advanceTimersByTime(1500);
    expect(isTabAwaitingAttention("tab-a")).toBe(false); // only 2 of 3 lines
    reportOutput("tab-a", 1);
    vi.advanceTimersByTime(1500);
    expect(isTabAwaitingAttention("tab-a")).toBe(true);
  });

  it("setActivityIdleMs changes how long a busy tab takes to flag as done", () => {
    setActivityIdleMs(500);
    reportOutput("tab-a", 1);
    reportOutput("tab-a", 1);
    vi.advanceTimersByTime(499);
    expect(isTabAwaitingAttention("tab-a")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isTabAwaitingAttention("tab-a")).toBe(true);
  });

  it("disposeTerminalActivity clears state AND the running idle timer", () => {
    reportOutput("tab-a", 1);
    expect(vi.getTimerCount()).toBe(1);
    disposeTerminalActivity("tab-a");
    expect(isTabAwaitingAttention("tab-a")).toBe(false);
    // No orphaned timer left running — otherwise a reused tabId would
    // inherit its later firing effect.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resetTerminalActivityForTests also resets viewedTabId", () => {
    reportOutput("tab-a", 1);
    reportOutput("tab-a", 1);
    markTabViewed("tab-a");
    resetTerminalActivityForTests();

    reportOutput("tab-a", 1); // fresh entry after reset, consumes its own boot prompt
    reportOutput("tab-a", 1);
    vi.advanceTimersByTime(1500);
    // Without the reset, "tab-a" would still be the viewed tab and
    // permanently suppress the marker — exactly the leak this test guards.
    expect(isTabAwaitingAttention("tab-a")).toBe(true);
  });
});
