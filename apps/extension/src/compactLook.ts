// Compact Look: hides secondary chrome to make room for more panes.
// The icon/activity bar itself must always remain reachable — Compact Look
// never fully hides it — but it moves from the left edge to a row above the
// explorer (`workbench.activityBar.location: "top"`), alongside collapsing
// the native window menu bar. Both, like status bar/minimap, are restorable
// to their exact prior value (not just VS Code's own default) via
// `ExtensionContext.workspaceState`.
import * as vscode from "vscode";
import type { Memento as CompactLookMemento } from "./vscodeMemento";
export type { CompactLookMemento };

const SAVED_STATE_KEY = "panecrew.compactLook.previousValues";

interface SavedLookValues {
  statusBarVisible: boolean | undefined;
  minimapEnabled: boolean | undefined;
  activityBarLocation: string | undefined;
  menuBarVisibility: string | undefined;
}

export async function applyCompactLook(memento: CompactLookMemento): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const panecrewConfig = vscode.workspace.getConfiguration("panecrew");
  const hideStatusBar = panecrewConfig.get<boolean>("compactLook.hideStatusBar", false);
  const hideMinimap = panecrewConfig.get<boolean>("compactLook.hideMinimap", true);

  const saved: SavedLookValues = {
    statusBarVisible: config.inspect<boolean>("workbench.statusBar.visible")?.globalValue,
    minimapEnabled: config.inspect<boolean>("editor.minimap.enabled")?.globalValue,
    activityBarLocation: config.inspect<string>("workbench.activityBar.location")?.globalValue,
    menuBarVisibility: config.inspect<string>("window.menuBarVisibility")?.globalValue,
  };
  await memento.update(SAVED_STATE_KEY, saved);

  if (hideStatusBar) {
    await config.update("workbench.statusBar.visible", false, vscode.ConfigurationTarget.Global);
  }
  if (hideMinimap) {
    await config.update("editor.minimap.enabled", false, vscode.ConfigurationTarget.Global);
  }
  // Moves the activity bar above the explorer rather than hiding it —
  // "compact" reclaims the left-edge icon rail without losing access to it —
  // and collapses the native window menu bar down to a single icon.
  await config.update("workbench.activityBar.location", "top", vscode.ConfigurationTarget.Global);
  await config.update("window.menuBarVisibility", "compact", vscode.ConfigurationTarget.Global);
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
  await config.update(
    "workbench.activityBar.location",
    saved?.activityBarLocation,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "window.menuBarVisibility",
    saved?.menuBarVisibility,
    vscode.ConfigurationTarget.Global,
  );
}
