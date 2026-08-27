// Cross-repo overview — .scratch/git-forge-integration issue 02. A second,
// flat TreeDataProvider (not a subtree of the main explorer) listing every
// workspace folder that's a usable git repo, each with its
// branch/ahead-behind/dirty/PR-CI summary — "which of my open projects has
// unfinished work" at a glance, without switching the main explorer's
// focus-followed project.
import * as vscode from "vscode";
import { formatStatusLabel, type ProjectStatus } from "./projectStatus";

export class PaneCrewCrossRepoViewProvider implements vscode.TreeDataProvider<vscode.WorkspaceFolder> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly statusByFolder = new Map<string, ProjectStatus | undefined>();

  /** Same "set everything, fire once" contract as
   * `treeDataProvider.ts`'s `setRootDescription`. */
  setStatus(folderUri: vscode.Uri, status: ProjectStatus | undefined): void {
    this.statusByFolder.set(folderUri.toString(), status);
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(folder: vscode.WorkspaceFolder): vscode.TreeItem {
    const status = this.statusByFolder.get(folder.uri.toString());
    const item = new vscode.TreeItem(folder.name, vscode.TreeItemCollapsibleState.None);
    item.description = status ? formatStatusLabel(status) : undefined;
    item.tooltip = status?.pr?.url;
    item.iconPath = new vscode.ThemeIcon(status ? "repo" : "circle-slash");
    item.contextValue = "panecrew.crossRepoProject";
    item.command = {
      command: "panecrew.focusProjectInExplorer",
      title: "Focus in PaneCrew Explorer",
      arguments: [folder],
    };
    return item;
  }

  getChildren(element?: vscode.WorkspaceFolder): vscode.WorkspaceFolder[] {
    if (element) return [];
    // Only folders a status has ever been computed for — a non-git folder
    // (status resolved to `undefined` but was at least attempted) still
    // gets an entry; a folder no refresh has reached yet (right after
    // activation, before the first pass completes) is left out rather than
    // showing every workspace folder with a misleading "not a repo" state
    // that's really just "not checked yet".
    return (vscode.workspace.workspaceFolders ?? []).filter((folder) =>
      this.statusByFolder.has(folder.uri.toString()),
    );
  }
}
