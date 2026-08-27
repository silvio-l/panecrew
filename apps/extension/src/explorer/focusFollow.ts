// The product's signature feature: whichever pane (terminal or tab) has
// focus, the PaneCrew explorer reveals that pane's owning workspace folder.
// Listens to both `vscode.window.onDidChangeActiveTerminal` (terminal focus)
// and `vscode.window.tabGroups.onDidChangeTabGroups`/`onDidChangeTabs` (editor
// tab focus, since a pane can also host File-Tabs per the ported
// `gridState.ts`), maps the active terminal/tab back to the pane that owns
// it, and reveals that pane's project root in the tree view.
import * as vscode from "vscode";
import type { Pane } from "../grid/gridState";
import type { FolderRootItem, ProjectTreeItem } from "./treeDataProvider";

/** The minimal terminal-tracking surface `layoutController.ts`'s
 * `GridLayoutController` needs to expose for focus-follow to resolve
 * "which pane owns this terminal" — kept separate from the controller's
 * full interface so this module doesn't need to import `vscode.Terminal`
 * lookups beyond what it actually reads. */
export interface PaneLookup {
  /** The pane that owns a given live terminal, or `null` if the terminal
   * isn't one PaneCrew created (e.g. a terminal the user opened by hand). */
  paneForTerminal(terminal: vscode.Terminal): Pane | null;
}

function rootItemForProjectPath(
  projectPath: string,
  folders: readonly vscode.WorkspaceFolder[],
): FolderRootItem | null {
  const folder = folders.find((f) => f.uri.fsPath === projectPath);
  return folder ? { kind: "root", folder } : null;
}

/** Wires up both focus sources. Returns the disposables the caller
 * (`extension.ts`) must add to `context.subscriptions`. */
export function registerFocusFollow(
  treeView: vscode.TreeView<ProjectTreeItem>,
  lookup: PaneLookup,
): vscode.Disposable[] {
  const revealForTerminal = (terminal: vscode.Terminal | undefined) => {
    if (!terminal) return;
    const pane = lookup.paneForTerminal(terminal);
    if (!pane) return;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const root = rootItemForProjectPath(pane.projectPath, folders);
    if (!root) return;
    void treeView.reveal(root, { select: true, focus: false, expand: true });
  };

  const revealForActiveTab = () => {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!activeTab) return;
    const input = activeTab.input;
    if (!(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom)) return;
    const uri = input.uri;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    void treeView.reveal({ kind: "root", folder }, { select: true, focus: false, expand: true });
  };

  return [
    vscode.window.onDidChangeActiveTerminal(revealForTerminal),
    vscode.window.tabGroups.onDidChangeTabGroups(revealForActiveTab),
    vscode.window.tabGroups.onDidChangeTabs(revealForActiveTab),
  ];
}

