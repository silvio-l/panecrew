import { useCallback, useSyncExternalStore } from "react";
import type { Terminal } from "@xterm/xterm";

// Attention signal for terminal tabs: "this pane did real work, then went
// quiet — you probably want to look at it." Tool-agnostic by construction:
// it never parses PTY content, only counts committed lines (see
// `committedLineCount`) and tracks whether *any* bytes arrived recently.
//
// Semantics (2026-08-17 rewrite, replacing the previous persistent "unread"
// badge): the marker appears once a tab that has done genuine work falls
// silent for `idleMs`, and disappears the instant new output arrives OR the
// user actually looks at the tab. This is the inverse of the old "unread"
// signal (which appeared on new background output and stuck until viewed,
// regardless of further activity) — the user's own description made clear
// that's what they wanted: a "done, your turn" indicator, not an "unread
// mail" indicator. It must react to renewed activity, which the previous
// design explicitly did not (see `terminalActivity.test.ts`'s regression
// test for the old "danach passierte nichts" finding, and `PaneTabs.tsx`'s
// header comment for the full history of the earlier design).
//
// Lines, not characters/bytes, decide whether a tab has ever done "real
// work": Ink-based CLI agents repaint prompt/spinner/status lines via escape
// sequences continuously, even while idle or merely thinking — a raw
// byte/char diff on `terminal.write()` would call an idle prompt "active"
// forever. `buffer.active.baseY + cursorY` only grows when new line content
// is actually committed (token streaming), not on an in-place redraw. In the
// alternate buffer (vim, htop, any fullscreen TUI) `baseY` never grows at
// all — `committedLineCount` returns `null` there rather than a misleading
// 0, and this module simply never learns such a tab as "has done real
// work", so it never shows the marker for it. That's a deliberate scope
// limit, not an oversight: a fullscreen TUI doesn't have a meaningful
// "finished, waiting on you" moment the way a turn-based CLI agent does.
//
// Liveness (whether a tab currently counts as "busy") is a SEPARATE signal
// from line commits, and deliberately driven by ANY output, line-advancing
// or not. Root-cause finding (2026-08-17, real PTY capture of a live Claude // brandlint-ok: functional reference to the specific tool tested, not marketing
// Code session, see the bug's investigation): a purely spinner-driven
// "thinking" phase between tool calls can run several seconds without
// committing a single new line. Gating liveness on line advances alone (as
// the old `active` internal state did) let that idle timer expire mid-turn,
// which — had the "done" marker been built on top of it, as first
// considered — would have flagged an agent that's still visibly working as
// "waiting on you". `reportOutput` is called on every completed flush
// regardless of its line delta specifically to avoid that.
//
// Module-global registry instead of a local usePtyTerminal return value:
// PaneGrid.tsx keeps every terminal tab of a pane mounted permanently (even
// invisible ones) and renders PaneTabs multiple times — every copy needs the
// signal for ALL tabs of the pane, not just its own tabId. Same pattern as
// useDetectedTool.ts, there polled, here push-driven because
// usePtyTerminal.ts already knows exactly when new output arrives.
//
// Two real settings fields (`terminal.activityIdleMs`/
// `terminal.activityLineThreshold`, config_core.rs) instead of fixed
// constants — live-populated by applyActivitySettings.ts, the only module
// that ever calls these two setters. Deliberately kept out of this file: the
// Tauri invoke/listen calls there would make terminalActivity.test.ts (calls
// `reportOutput` directly, without a real backend) fail on the bare import.
const DEFAULT_IDLE_MS = 15000;
const DEFAULT_LINE_THRESHOLD = 1;
let idleMs = DEFAULT_IDLE_MS;
let lineThreshold = DEFAULT_LINE_THRESHOLD;

// Exactly ONE globally viewed tab (`viewedTabId`), not a per-pane state —
// same reasoning as the previous design: "viewed" only has one sensible
// meaning app-wide, reported by PaneTabs.tsx's `TerminalTabChip` as the one
// tab that is both selected within its pane AND whose pane currently has
// grid focus.
let viewedTabId: string | null = null;

export function setActivityIdleMs(value: number): void {
  if (Number.isFinite(value) && value > 0) idleMs = value;
}

export function setActivityLineThreshold(value: number): void {
  if (Number.isFinite(value) && value >= 1) lineThreshold = value;
}

interface ActivityEntry {
  /** True while output has arrived within the last `idleMs` — the pure
   * liveness signal, updated on every flush regardless of its line delta
   * (see header comment). Flips false via `idleTimer` once `idleMs` passes
   * without any further output. */
  busy: boolean;
  /** Set once this tab has committed at least `lineThreshold` real lines,
   * beyond its very first qualifying burst (the shell/tool's own startup
   * prompt — see `bootBurstConsumed`). Never reset — a tab that has done
   * real work once remains eligible for the "done" marker for its whole
   * lifetime. Without this gate, a freshly spawned, still-empty shell would
   * flag "waiting on you" a few seconds after opening, for having done
   * nothing at all. */
  hasBeenActive: boolean;
  /** Lines committed towards `lineThreshold` since the boot burst was
   * consumed — mirrors the previous design's debounce reasoning: a single
   * flush is one animation frame, a streaming agent commits only 1-2 lines
   * in it, so any threshold above 1 needs to accumulate across flushes to
   * be usable at all. */
  pendingLines: number;
  /** The very first qualifying line burst of a fresh entry is the shell's
   * own startup prompt, not evidence of real work — consumed once, then
   * never checked again. */
  bootBurstConsumed: boolean;
  idleTimer: number;
  listeners: Set<() => void>;
}

const entries = new Map<string, ActivityEntry>();

function getOrCreateEntry(tabId: string): ActivityEntry {
  let entry = entries.get(tabId);
  if (!entry) {
    entry = {
      busy: false,
      hasBeenActive: false,
      pendingLines: 0,
      bootBurstConsumed: false,
      idleTimer: 0,
      listeners: new Set(),
    };
    entries.set(tabId, entry);
  }
  return entry;
}

function notify(entry: ActivityEntry): void {
  for (const listener of entry.listeners) listener();
}

/** Committed line position (scrollback + cursor row) in the normal buffer,
 * `null` in the alternate buffer (there, "active/inactive" isn't meaningfully
 * definable, see header comment). Measured by the caller BEFORE and AFTER a
 * `terminal.write()` — the difference is the number of newly committed
 * lines. */
export function committedLineCount(terminal: Terminal): number | null {
  const buffer = terminal.buffer.active;
  return buffer.type === "normal" ? buffer.baseY + buffer.cursorY : null;
}

/** Called by usePtyTerminal.ts after EVERY completed flush, whether or not
 * it committed new lines (`linesAdvanced` is 0, or the alt-buffer sentinel
 * value, when nothing committed — see header comment on why liveness must
 * not depend on line advances alone). */
export function reportOutput(tabId: string, linesAdvanced: number): void {
  const entry = getOrCreateEntry(tabId);

  window.clearTimeout(entry.idleTimer);
  const wasBusy = entry.busy;
  entry.busy = true;
  entry.idleTimer = window.setTimeout(() => {
    entry.busy = false;
    notify(entry);
  }, idleMs);

  if (linesAdvanced > 0 && !entry.hasBeenActive) {
    entry.pendingLines += linesAdvanced;
    if (entry.pendingLines >= lineThreshold) {
      entry.pendingLines = 0;
      if (entry.bootBurstConsumed) {
        entry.hasBeenActive = true;
      } else {
        entry.bootBurstConsumed = true;
      }
    }
  }

  // A transition on `busy` alone is enough to notify: `isTabAwaitingAttention`
  // is derived (see below), so listeners must re-read it whenever any input
  // to that derivation could have changed. `hasBeenActive` only ever flips
  // false→true, and only matters once `busy` is already false (a tab can't
  // become "awaiting attention" the instant it becomes active) — no separate
  // notify needed for it.
  if (wasBusy !== entry.busy) notify(entry);
}

/** Called from the cleanup of the same usePtyTerminal instance that owns the
 * tab — without this, a closed tab would keep its idle timer, and a reused
 * tabId would inherit its old state. */
export function disposeTerminalActivity(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  window.clearTimeout(entry.idleTimer);
  entries.delete(tabId);
}

/** Test-only: resets every entry AND `viewedTabId` — the latter isn't tied to
 * any single tab entry and would otherwise leak unnoticed from one test into
 * the next in the same file (same leak risk `setActivityIdleMs`/
 * `setActivityLineThreshold` need their own `afterEach` reset for). */
export function resetTerminalActivityForTests(): void {
  for (const tabId of entries.keys()) disposeTerminalActivity(tabId);
  viewedTabId = null;
}

/** Pure function of current state — deliberately NOT a stored flag: the
 * "awaiting attention" marker for `tabId` is exactly "has done real work,
 * currently silent, and isn't the tab the user is looking at". Computing it
 * live (rather than caching it as a separate boolean that would need manual
 * invalidation on every input change) is what makes `markTabViewed`'s
 * "the previously viewed tab may now qualify" case below correct for free:
 * there is no stale sticky state to reconcile, only inputs that changed. */
export function isTabAwaitingAttention(tabId: string): boolean {
  const entry = entries.get(tabId);
  if (!entry) return false;
  return entry.hasBeenActive && !entry.busy && tabId !== viewedTabId;
}

/** Reports that the user is actually looking at `tabId` right now
 * (PaneTabs.tsx's `TerminalTabChip`, selected AND its own pane grid-focused).
 * Sets `viewedTabId` even if no entry exists yet for this tab (e.g. a tab
 * with no PTY output so far) — later `reportOutput` calls for it must still
 * recognise it as "the viewed one" correctly.
 *
 * Also re-evaluates the PREVIOUSLY viewed tab: since "awaiting attention" is
 * derived from `viewedTabId` (see `isTabAwaitingAttention`), the moment the
 * user looks away from a tab that has been silently done for a while, it
 * must be able to show the marker immediately — without this, a tab that
 * went idle while it happened to be the viewed one would never get a chance
 * to flag itself once the user moves on. */
export function markTabViewed(tabId: string): void {
  const previousTabId = viewedTabId;
  if (previousTabId === tabId) return;
  viewedTabId = tabId;

  if (previousTabId !== null) {
    const previousEntry = entries.get(previousTabId);
    if (previousEntry) notify(previousEntry);
  }
  const entry = entries.get(tabId);
  if (entry) notify(entry);
}

function subscribe(tabId: string, listener: () => void): () => void {
  const entry = getOrCreateEntry(tabId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

/** Push-driven React hook — liveness for `tabId` (see `isTabAwaitingAttention`
 * above for the exact definition). */
export function useTerminalAwaitingAttention(tabId: string): boolean {
  const subscribeForTab = useCallback(
    (listener: () => void) => subscribe(tabId, listener),
    [tabId],
  );
  const getSnapshot = useCallback(() => isTabAwaitingAttention(tabId), [tabId]);
  return useSyncExternalStore(subscribeForTab, getSnapshot);
}
