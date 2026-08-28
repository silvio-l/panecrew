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

  // .scratch/pane-attention-notifications — same source of truth as the
  // main explorer's PaneCrewAttentionDecorationProvider (extension.ts calls
  // both from the same mark/clear call sites), just rendered as a text
  // indicator prefixed onto the existing combined status label instead of a
  // second display mechanism.
  private readonly attentionByFolder = new Map<string, boolean>();

  /** Same "set everything, fire once" contract as
   * `treeDataProvider.ts`'s `setRootDescription` — returns whether the
   * status actually changed, so a poll that finds nothing new can skip the
   * `refresh()` call. */
  setStatus(folderUri: vscode.Uri, status: ProjectStatus | undefined): boolean {
    const key = folderUri.toString();
    const previous = this.statusByFolder.get(key);
    if (previous === status) return false;
    if (previous !== undefined && status !== undefined && formatStatusLabel(previous) === formatStatusLabel(status)) {
      this.statusByFolder.set(key, status);
      return false;
    }
    this.statusByFolder.set(key, status);
    return true;
  }

  /** Returns whether the attention flag actually changed, same "skip the
   * refresh if nothing changed" contract as `setStatus`. */
  setAttention(folderUri: vscode.Uri, hasAttention: boolean): boolean {
    const key = folderUri.toString();
    if (this.attentionByFolder.get(key) === hasAttention) return false;
    this.attentionByFolder.set(key, hasAttention);
    return true;
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(folder: vscode.WorkspaceFolder): vscode.TreeItem {
    const status = this.statusByFolder.get(folder.uri.toString());
    const hasAttention = this.attentionByFolder.get(folder.uri.toString()) ?? false;
    const item = new vscode.TreeItem(folder.name, vscode.TreeItemCollapsibleState.None);
    const statusLabel = status ? formatStatusLabel(status) : undefined;
    item.description = hasAttention ? ["●", statusLabel].filter(Boolean).join(" ") : statusLabel;
    item.tooltip = status?.pr?.url;
    // A plain "●" in the small grey `description` text is easy to miss —
    // the icon swap (bell + warning color) is the actually-visible signal,
    // since Projects Overview is the one place multiple projects are shown
    // side by side (the main explorer only ever shows one at a time, where
    // the existing FileDecorationProvider badge is enough).
    item.iconPath = hasAttention
      ? new vscode.ThemeIcon("bell-dot", new vscode.ThemeColor("list.warningForeground"))
      : new vscode.ThemeIcon(status ? "repo" : "circle-slash");
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
