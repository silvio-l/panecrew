// Pure onboarding-hint logic, same split as `grid/gridState.ts` +
// `grid/useGrid.ts`: no React, no `@tauri-apps` import. Every show/hide
// decision is derived from the live grid, not a separate "onboarding phase"
// state machine — a Settings-triggered restart, a true first run, and a
// grid that already has panes from a restored session all fall out of the
// same two functions below.

import { activePanes, firstEmptySlotIndex, type GridState } from "../grid/gridState";

/** Number of open panes that counts as the onboarding Aha-Moment (opening a
 * second project is what demonstrates the multi-pane grid, PaneCrew's core
 * differentiator — a single pane looks like any other terminal app). */
const AHA_MOMENT_PANE_COUNT = 2;

/** The empty slot the hint should anchor to, or `null` if the grid has no
 * empty slot (every template slot already holds a pane) — a real but
 * non-blocking edge case, the hint simply doesn't render anywhere. */
export function onboardingHintSlot(state: GridState): number | null {
  const index = firstEmptySlotIndex(state);
  return index === -1 ? null : index;
}

/** `"empty"` for a true first run (nothing open yet — lead with what
 * PaneCrew is), `"hasPanes"` once at least one project is already open
 * (lead with the next action: open a second one). */
export function onboardingHintVariant(state: GridState): "empty" | "hasPanes" {
  return activePanes(state).length === 0 ? "empty" : "hasPanes";
}

/** Whether the Aha-Moment has been reached and onboarding should be marked
 * completed. Deliberately a plain count threshold, not tied to which slots
 * or which projects — any two simultaneously open panes demonstrate the
 * grid. */
export function onboardingShouldComplete(state: GridState): boolean {
  return activePanes(state).length >= AHA_MOMENT_PANE_COUNT;
}
