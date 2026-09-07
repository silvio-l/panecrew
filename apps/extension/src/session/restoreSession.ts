// Pure activation-time restore logic, pulled out of `extension.ts` so it has
// a real test seam (no `vscode` import needed — `assignProjectToSlot` et al.
// are already plain functions over `GridState`).
import {
  assignProjectToSlot,
  DEFAULT_TEMPLATE,
  firstEmptySlotIndex,
  INITIAL_GRID_STATE,
  type GridState,
  type TemplateId,
} from "../grid/gridState";
import type { RestoredSession } from "./persistence";

export interface RestoreResult {
  gridState: GridState;
  /** Carried forward into the next `saveSession` call unchanged, minus any
   * path that ended up assigned to a slot again. */
  closedProjectPaths: Set<string>;
  /** paneIds assigned from `restored.slots` specifically — i.e. panes with
   * genuine continuity from a PREVIOUSLY PERSISTED PaneCrew session for this
   * exact workspace, as opposed to the backfill loop's panes (a still-open
   * folder PaneCrew has no persisted memory of, whether because it's
   * genuinely new to PaneCrew or because `restored` came back null/stale —
   * see this module's own header comment on that unreliability). Consumers
   * that decide whether it's plausible a live PaneCrew-tracked command is
   * running in an adopted terminal (see `extension.ts`'s `logAdoptedPanes`)
   * must check this set, not just "was some live terminal adopted" —
   * `GridLayoutController.ensureTerminal`'s adoption match is a coincidental
   * cwd/name match against ANY live terminal in the window, including one
   * PaneCrew never created (e.g. an ordinary terminal VS Code's own,
   * unrelated persistent-session revival brought back for a folder that was
   * simply opened in plain VS Code before ever being added to a PaneCrew
   * grid) — bug reported 2026-09-07: a brand-new-to-PaneCrew pane triggered
   * the "attention notifications won't fire, restart terminal" warning
   * (which claims to end an in-progress CLI agent session) even though
   * PaneCrew itself never tracked anything there. */
  restoredPaneIds: Set<string>;
}

/**
 * Rebuilds grid state on activation: replays whatever session was persisted,
 * then backfills any still-open workspace folder the restore doesn't already
 * cover — but never a folder whose pane the user deliberately closed
 * (`restored.closedProjectPaths`), and never a folder already present in
 * `restored.slots` regardless of index.
 *
 * The backfill step exists for a narrower case than "every open folder":
 * `workspaceState` isn't reliably persisted across a "Developer: Reload
 * Window" for an unsaved multi-root workspace, so `restored` can come back
 * `null`/incomplete even though the folder is genuinely still open — that
 * folder still needs a tracked pane or focus-follow can never resolve it
 * (bugfix 87ace63, 2026-08-27). Without the `closedProjectPaths` check, that
 * same backfill loop also re-opens a pane for every project the user closed
 * on purpose, since a closed pane is just a `null` slot — indistinguishable
 * from "never tracked" (bug reported 2026-08-28).
 *
 * `fallbackTemplate` (from `panecrew.grid.defaultColumns`/`defaultRows`) is
 * used only when `restored` is `null` -- it used to be applied by a
 * `switchTemplate` call in `extension.ts` *before* this function ran, but
 * that assignment was silently discarded because this function always
 * started from a fresh `INITIAL_GRID_STATE` regardless of what its caller
 * had already computed, so the setting had no effect whenever a session
 * failed to restore (bug reported 2026-09-07: a user-configured
 * `defaultRows: 1` default -- meant to land on "split" -- never took effect,
 * silently falling back to the hardcoded `DEFAULT_TEMPLATE` ("quad")
 * instead, indistinguishable from "my last session just didn't restore").
 */
export function restoreGridState(
  restored: RestoredSession | null,
  openFolderPaths: readonly string[],
  makeId: () => string,
  fallbackTemplate: TemplateId = DEFAULT_TEMPLATE,
): RestoreResult {
  let gridState: GridState = { ...INITIAL_GRID_STATE, template: fallbackTemplate };
  const closedProjectPaths = new Set(restored?.closedProjectPaths ?? []);
  const restoredPaneIds = new Set<string>();

  if (restored) {
    gridState = { ...INITIAL_GRID_STATE, template: restored.template, splitRatios: restored.splitRatios };
    restored.slots.forEach((slot, index) => {
      if (!slot) return;
      const paneId = makeId();
      gridState = assignProjectToSlot(gridState, index, slot.project_path, paneId, makeId());
      restoredPaneIds.add(paneId);
      closedProjectPaths.delete(slot.project_path);
    });
  }

  for (const path of openFolderPaths) {
    const alreadyTracked = gridState.slots.some((slot) => slot?.projectPath === path);
    if (alreadyTracked || closedProjectPaths.has(path)) continue;
    const slotIndex = firstEmptySlotIndex(gridState);
    if (slotIndex === -1) break;
    gridState = assignProjectToSlot(gridState, slotIndex, path, makeId(), makeId());
  }

  return { gridState, closedProjectPaths, restoredPaneIds };
}
