// Compact Look: hides secondary chrome to make room for more panes.
// IMPORTANT product requirement: the top icon/activity bar row must remain
// visible in PaneCrew's standard look — this module never touches
// `workbench.activityBar.location`/visibility, only status bar and minimap,
// both restorable to their exact prior value (not just VS Code's own
// default) via `ExtensionContext.workspaceState`.
//
// Deliberately scoped to `ConfigurationTarget.Workspace`, not `Global`
// (2026-08-27 fix): this is a per-project "give this grid more room" toggle,
// not a user-wide VS Code preference — writing it globally meant applying
// Compact Look once left `workbench.statusBar.visible: false` set for every
// unrelated VS Code window, requiring a manual View → Appearance → Status
// Bar toggle to notice/undo it had nothing to do with PaneCrew.
import * as vscode from "vscode";
import type { Memento as CompactLookMemento } from "./vscodeMemento";
export type { CompactLookMemento };

const SAVED_STATE_KEY = "panecrew.compactLook.previousValues";

interface SavedLookValues {
  statusBarVisible: boolean | undefined;
  minimapEnabled: boolean | undefined;
}

export async function applyCompactLook(memento: CompactLookMemento): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const panecrewConfig = vscode.workspace.getConfiguration("panecrew");
  const hideStatusBar = panecrewConfig.get<boolean>("compactLook.hideStatusBar", false);
  const hideMinimap = panecrewConfig.get<boolean>("compactLook.hideMinimap", true);

  const saved: SavedLookValues = {
    statusBarVisible: config.inspect<boolean>("workbench.statusBar.visible")?.workspaceValue,
    minimapEnabled: config.inspect<boolean>("editor.minimap.enabled")?.workspaceValue,
  };
  await memento.update(SAVED_STATE_KEY, saved);

  if (hideStatusBar) {
    await config.update("workbench.statusBar.visible", false, vscode.ConfigurationTarget.Workspace);
  }
  if (hideMinimap) {
    await config.update("editor.minimap.enabled", false, vscode.ConfigurationTarget.Workspace);
  }
  // Deliberately never touched: workbench.activityBar.location/visibility —
  // Compact Look must never hide the top icon/activity bar row.
}

export async function restoreLook(memento: CompactLookMemento): Promise<void> {
  const saved = memento.get<SavedLookValues>(SAVED_STATE_KEY);
  const config = vscode.workspace.getConfiguration();
  await config.update(
    "workbench.statusBar.visible",
    saved?.statusBarVisible,
    vscode.ConfigurationTarget.Workspace,
  );
  await config.update(
    "editor.minimap.enabled",
    saved?.minimapEnabled,
    vscode.ConfigurationTarget.Workspace,
  );
}
