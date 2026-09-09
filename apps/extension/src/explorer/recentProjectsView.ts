// "Recent Projects" view — a second, flat TreeDataProvider (same shape as
// attentionQueueView.ts/git/crossRepoView.ts) shown only in a still-empty
// window (package.json's `"when": "workbenchState == empty"` on the view
// itself), so the "no projects in this grid yet" empty state offers a
// one-click way back into the last few projects instead of only the folder
// picker (.scratch/recent-projects-empty-state ticket 01).
import * as vscode from "vscode";
import { loadRecentProjects, pruneMissingRecentProjects } from "./recentProjects";
import type { Memento } from "../vscodeMemento";

export interface RecentProjectEntry {
  path: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(path));
    return true;
  } catch {
    return false;
  }
}

export class PaneCrewRecentProjectsViewProvider implements vscode.TreeDataProvider<RecentProjectEntry> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly globalState: Memento) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(entry: RecentProjectEntry): vscode.TreeItem {
    const name = entry.path.split(/[\\/]/).filter(Boolean).pop() ?? entry.path;
    const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
    item.description = entry.path;
    item.tooltip = entry.path;
    item.iconPath = vscode.ThemeIcon.Folder;
    item.command = {
      command: "panecrew.openRecentProject",
      title: "Open Recent Project",
      arguments: [entry.path],
    };
    return item;
  }

  async getChildren(element?: RecentProjectEntry): Promise<RecentProjectEntry[]> {
    if (element) return [];
    const kept = await pruneMissingRecentProjects(this.globalState, pathExists);
    return kept.map((project) => ({ path: project.path }));
  }
}

/** Whether the "Recent Projects" view has anything to show right now —
 * drives the `panecrew.hasRecentProjects` context key (extension.ts), which
 * package.json's view `when` clause is gated on so the section doesn't take
 * up sidebar space with nothing in it. */
export function hasRecentProjects(globalState: Memento): boolean {
  return loadRecentProjects(globalState).length > 0;
}
