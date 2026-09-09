// PaneCrew's own status bar entries, shown in the PaneCrew look in place of
// the title-bar controls the old Tauri desktop app had — a VS Code extension
// has no API to add buttons to the native title bar, the status bar is the
// closest equivalent surface. Two items: the current grid template (click to
// switch) and a shortcut to open a new VS Code window. Individually hiding
// *other* contributors' status bar entries isn't possible through the
// extension API either (only the whole bar can be toggled, via
// `workbench.statusBar.visible`) — a user who wants a bare-bones status bar
// still does that per item themselves via its right-click "Hide" menu.
import * as vscode from "vscode";
import { GRID_TEMPLATES, type TemplateId } from "./grid/gridState";
import { gridTemplateStatusText, templateLabel } from "./grid/gridStatusLabel";

/** `panecrew.grid.defaultProjectsFolder`, as the `defaultUri` every project
 * folder picker opens in — empty setting means "let VS Code pick", same as
 * omitting `defaultUri` entirely. */
export function defaultProjectsFolderUri(): vscode.Uri | undefined {
  const configured = vscode.workspace.getConfiguration("panecrew").get<string>("grid.defaultProjectsFolder", "");
  return configured.trim() === "" ? undefined : vscode.Uri.file(configured);
}

/** `PaneCrew: Set Default Projects Folder…` — a folder picker for
 * `panecrew.grid.defaultProjectsFolder`, since VS Code's Settings UI has no
 * browse-for-folder widget for extension-contributed string settings. */
export function registerSetDefaultProjectsFolderCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("panecrew.setDefaultProjectsFolder", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Set as Default Projects Folder",
        defaultUri: defaultProjectsFolderUri(),
      });
      const folderUri = picked?.[0];
      if (!folderUri) return;
      await vscode.workspace
        .getConfiguration("panecrew")
        .update("grid.defaultProjectsFolder", folderUri.fsPath, vscode.ConfigurationTarget.Global);
    }),
  );
}

export interface GridTemplateStatusBarItem extends vscode.Disposable {
  /** `occupiedSlotCount` — how many of the template's slots currently hold a
   * pane — is required on every call, not defaulted, so a caller can't
   * accidentally refresh only the template id and leave a stale occupancy
   * count rendered (see `gridTemplateStatusText`'s doc comment for the bug
   * this closes). */
  setTemplate(template: TemplateId, occupiedSlotCount: number): void;
}

/** The grid-template picker. `onPick` is called with the chosen template id
 * once the caller (extension.ts, which owns `gridState`) should apply it —
 * this module only renders the picker and the current-state label, it
 * doesn't own grid state itself. */
export function createGridTemplateStatusBarItem(
  context: vscode.ExtensionContext,
  initialTemplate: TemplateId,
  initialOccupiedSlotCount: number,
  onPick: (template: TemplateId) => void,
): GridTemplateStatusBarItem {
  const commandId = "panecrew.setGridTemplate";
  const item = vscode.window.createStatusBarItem("panecrew.gridTemplate", vscode.StatusBarAlignment.Left, 100);
  item.name = "PaneCrew: Grid Template";
  item.command = commandId;
  item.tooltip = "PaneCrew: change the grid template";
  item.accessibilityInformation = {
    label: "PaneCrew: change the grid template",
    role: "button",
  };

  const render = (templateId: TemplateId, occupiedSlotCount: number) => {
    const template = GRID_TEMPLATES.find((t) => t.id === templateId) ?? GRID_TEMPLATES[0];
    item.text = `$(layout) ${gridTemplateStatusText(template, occupiedSlotCount)}`;
  };
  render(initialTemplate, initialOccupiedSlotCount);
  item.show();

  const commandDisposable = vscode.commands.registerCommand(commandId, async () => {
    const picked = await vscode.window.showQuickPick(
      GRID_TEMPLATES.map((template) => ({
        label: templateLabel(template),
        description: `${template.slotCount} pane${template.slotCount === 1 ? "" : "s"}`,
        template,
      })),
      { placeHolder: "Choose a grid template", ignoreFocusOut: true },
    );
    if (!picked) return;
    onPick(picked.template.id);
  });
  context.subscriptions.push(commandDisposable);

  return {
    setTemplate: render,
    dispose: () => {
      item.dispose();
    },
  };
}

/** Shortcut to open another project in a new window — the closest
 * PaneCrew-styled equivalent to the desktop app's title-bar "new window"
 * affordance. Deliberately not bound to the bare `workbench.action.newWindow`
 * (2026-08-27 fix): that opens a completely empty window with nothing but
 * keyboard-shortcut hints, which isn't an actionable next step for a user —
 * this instead prompts for a folder immediately and opens it in the new
 * window in one step, mirroring `addFolderAndAssign`'s own folder picker. */
export function createNewWindowStatusBarItem(context: vscode.ExtensionContext): vscode.Disposable {
  const commandId = "panecrew.openProjectInNewWindow";
  const item = vscode.window.createStatusBarItem("panecrew.newWindow", vscode.StatusBarAlignment.Left, 99);
  item.name = "PaneCrew: New Window";
  item.text = "$(empty-window)";
  item.tooltip = "PaneCrew: open a project in a new window";
  item.accessibilityInformation = {
    label: "PaneCrew: open a project in a new window",
    role: "button",
  };
  item.command = commandId;
  item.show();

  context.subscriptions.push(
    vscode.commands.registerCommand(commandId, async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Open in New Window",
        defaultUri: defaultProjectsFolderUri(),
      });
      const folderUri = picked?.[0];
      if (!folderUri) return;
      await vscode.commands.executeCommand("vscode.openFolder", folderUri, { forceNewWindow: true });
    }),
  );

  return item;
}

/** Shortcut to toggle the primary side bar (and with it, the PaneCrew
 * explorer). Deliberately in the status bar rather than the explorer view's
 * own `view/title` toolbar (where it originally lived) — a button that only
 * lives inside the sidebar can't bring the sidebar back once it's hidden,
 * which defeats its own purpose; the status bar stays visible either way. */
export function createToggleSidebarStatusBarItem(): vscode.Disposable {
  const item = vscode.window.createStatusBarItem("panecrew.toggleSidebar", vscode.StatusBarAlignment.Left, 98);
  item.name = "PaneCrew: Toggle Primary Side Bar";
  item.text = "$(layout-sidebar-left)";
  item.tooltip = "PaneCrew: toggle primary side bar";
  item.accessibilityInformation = {
    label: "PaneCrew: toggle primary side bar",
    role: "button",
  };
  item.command = "panecrew.toggleSidebar";
  item.show();
  return item;
}
