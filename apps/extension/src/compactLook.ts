// Compact Look: hides secondary chrome to make room for more panes.
// IMPORTANT product requirement: the top icon/activity bar row must remain
// visible in PaneCrew's standard look — this module never touches
// `workbench.activityBar.location`/visibility, only status bar and minimap,
// both restorable to their exact prior value (not just VS Code's own
// default) via `ExtensionContext.workspaceState`.
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
    statusBarVisible: config.inspect<boolean>("workbench.statusBar.visible")?.globalValue,
    minimapEnabled: config.inspect<boolean>("editor.minimap.enabled")?.globalValue,
  };
  await memento.update(SAVED_STATE_KEY, saved);

  if (hideStatusBar) {
    await config.update("workbench.statusBar.visible", false, vscode.ConfigurationTarget.Global);
  }
  if (hideMinimap) {
    await config.update("editor.minimap.enabled", false, vscode.ConfigurationTarget.Global);
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
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "editor.minimap.enabled",
    saved?.minimapEnabled,
    vscode.ConfigurationTarget.Global,
  );
}
