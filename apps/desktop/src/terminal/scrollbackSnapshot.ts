// Thin wrapper around @xterm/addon-serialize (cross-window-drag ticket 02):
// each PaneCrew window is an independent DOM/JS runtime, so a moved
// terminal's xterm.js *instance* can't survive a cross-window move — only a
// snapshot of its visible scrollback can. Not wired into any actual move
// yet, verified purely against real xterm.js instances (see
// scrollbackSnapshot.test.ts).

import { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal } from "@xterm/xterm";

export type TerminalSnapshot = string;

/**
 * Serializes `terminal`'s current content, capped at the terminal's OWN
 * configured `scrollback` (xterm.js default: 1000 lines) rather than left
 * unspecified — the addon's own default for an unspecified `scrollback` is
 * "serialize the entire available buffer", which is exactly the unbounded
 * transfer this ticket rules out. Loads a fresh, single-use `SerializeAddon`
 * per call and disposes it immediately after — this wrapper stays stateless,
 * callers don't have to manage an addon's lifecycle alongside the
 * terminal's own.
 */
export function captureSnapshot(terminal: Terminal): TerminalSnapshot {
  const addon = new SerializeAddon();
  terminal.loadAddon(addon);
  try {
    return addon.serialize({ scrollback: terminal.options.scrollback ?? 1000 });
  } finally {
    addon.dispose();
  }
}

/**
 * Replays a snapshot into a freshly created terminal instance, positioning
 * the cursor correctly (the addon's own `serialize()` output already ends
 * with the cursor-repositioning sequence). Resolves once xterm has fully
 * processed the write, same async contract as `Terminal.write` itself.
 */
export function hydrateSnapshot(
  terminal: Terminal,
  snapshot: TerminalSnapshot,
): Promise<void> {
  return new Promise((resolve) => terminal.write(snapshot, resolve));
}
