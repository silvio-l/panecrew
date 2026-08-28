// Pure activation-time restore logic, pulled out of `extension.ts` so it has
// a real test seam (no `vscode` import needed — `assignProjectToSlot` et al.
// are already plain functions over `GridState`).
import { assignProjectToSlot, firstEmptySlotIndex, INITIAL_GRID_STATE, type GridState } from "../grid/gridState";
import type { RestoredSession } from "./persistence";

export interface RestoreResult {
  gridState: GridState;
  /** Carried forward into the next `saveSession` call unchanged, minus any
   * path that ended up assigned to a slot again. */
  closedProjectPaths: Set<string>;
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
 */
export function restoreGridState(
  restored: RestoredSession | null,
  openFolderPaths: readonly string[],
  makeId: () => string,
): RestoreResult {
  let gridState: GridState = INITIAL_GRID_STATE;
  const closedProjectPaths = new Set(restored?.closedProjectPaths ?? []);

  if (restored) {
    gridState = { ...INITIAL_GRID_STATE, template: restored.template, splitRatios: restored.splitRatios };
    restored.slots.forEach((slot, index) => {
      if (!slot) return;
      gridState = assignProjectToSlot(gridState, index, slot.project_path, makeId(), makeId());
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

  return { gridState, closedProjectPaths };
}
