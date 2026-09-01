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
// `window.menuBarVisibility` isn't a registered configuration on native
// macOS at all (VS Code only registers it for Windows/Linux/web — macOS
// always uses the system's own global menu bar instead). Writing to it
// there throws, and since every update below is awaited sequentially, that
// throw silently aborted the ENTIRE rest of apply/restoreLook — layout
// control, Copilot sign-in, "Open in Agents Window", and the chat/
// agent-status indicator never actually got touched on macOS, which is why
// the chat icon stayed visible in Compact Look there.
const SUPPORTS_MENU_BAR_VISIBILITY = process.platform !== "darwin";

interface SavedLookValues {
  statusBarVisible: boolean | undefined;
  minimapEnabled: boolean | undefined;
  activityBarLocation: string | undefined;
  menuBarVisibility: string | undefined;
  layoutControlEnabled: boolean | undefined;
  chatSignInEnabled: boolean | undefined;
  chatOpenInAgentsWindowEnabled: boolean | undefined;
  chatAgentsControlEnabled: string | undefined;
  editorActionsLocation: string | undefined;
  editorShowTabs: string | undefined;
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
    layoutControlEnabled: config.inspect<boolean>("workbench.layoutControl.enabled")?.globalValue,
    chatSignInEnabled: config.inspect<boolean>("chat.titleBar.signIn.enabled")?.globalValue,
    chatOpenInAgentsWindowEnabled: config.inspect<boolean>("chat.titleBar.openInAgentsWindow.enabled")
      ?.globalValue,
    chatAgentsControlEnabled: config.inspect<string>("chat.agentsControl.enabled")?.globalValue,
    editorActionsLocation: config.inspect<string>("workbench.editor.editorActionsLocation")?.globalValue,
    editorShowTabs: config.inspect<string>("workbench.editor.showTabs")?.globalValue,
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
  if (SUPPORTS_MENU_BAR_VISIBILITY) {
    await config.update("window.menuBarVisibility", "compact", vscode.ConfigurationTarget.Global);
  }
  // Clears the layout-picker/sidebar-toggle icon cluster, the Copilot
  // sign-in button / "Open in Agents Window" icon, and the chat/agent-status
  // indicator out of the title bar — all secondary chrome the same way the
  // status bar and minimap are. The command center's search pill itself
  // stays — it's the closest analog to macOS's own title bar search, not
  // chrome to strip.
  await config.update("workbench.layoutControl.enabled", false, vscode.ConfigurationTarget.Global);
  await config.update("chat.titleBar.signIn.enabled", false, vscode.ConfigurationTarget.Global);
  await config.update("chat.titleBar.openInAgentsWindow.enabled", false, vscode.ConfigurationTarget.Global);
  await config.update("chat.agentsControl.enabled", "hidden", vscode.ConfigurationTarget.Global);
  // PaneCrew's own pane-toolbar buttons (the "+" add-terminal button, the
  // per-pane restart/maximize buttons) live in the editor tab bar's action
  // toolbar, not in bespoke PaneCrew chrome — a minimalist VS Code setup
  // that hides tabs/actions (`workbench.editor.showTabs: "none"` or
  // `workbench.editor.editorActionsLocation: "hidden"`) would silently make
  // those buttons unreachable in Compact Look. Force both to their
  // guaranteed-visible values here, same save/restore treatment as every
  // other setting above, so applying Compact Look always leaves PaneCrew's
  // own controls reachable rather than depending on whatever the user's
  // editor-tab settings already happened to be.
  await config.update("workbench.editor.editorActionsLocation", "default", vscode.ConfigurationTarget.Global);
  await config.update("workbench.editor.showTabs", "multiple", vscode.ConfigurationTarget.Global);
  // The Chat/Copilot panel lives in the auxiliary (secondary) side bar, whose
  // visibility isn't a settings.json value — there's no config key for it,
  // only a command, so it can't be captured in SavedLookValues/restored to
  // its exact prior state the way the settings above are. Closing it is
  // idempotent (a no-op if already closed), so Compact Look always ends up
  // with it closed; re-open it manually (View > Appearance > Secondary Side
  // Bar, or the default Ctrl/Cmd+Alt+B) after Compact Look if wanted.
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
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
  if (SUPPORTS_MENU_BAR_VISIBILITY) {
    await config.update(
      "window.menuBarVisibility",
      saved?.menuBarVisibility,
      vscode.ConfigurationTarget.Global,
    );
  }
  await config.update(
    "workbench.layoutControl.enabled",
    saved?.layoutControlEnabled,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "chat.titleBar.signIn.enabled",
    saved?.chatSignInEnabled,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "chat.titleBar.openInAgentsWindow.enabled",
    saved?.chatOpenInAgentsWindowEnabled,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "chat.agentsControl.enabled",
    saved?.chatAgentsControlEnabled,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "workbench.editor.editorActionsLocation",
    saved?.editorActionsLocation,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "workbench.editor.showTabs",
    saved?.editorShowTabs,
    vscode.ConfigurationTarget.Global,
  );
}
