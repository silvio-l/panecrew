// FileDecorationProvider painting git status badges/colors onto the PaneCrew
// explorer's tree items — closes the PoC's documented "no git status
// coloring" gap. Shells out to `git status --porcelain=v1` once per
// workspace-folder root (via gitStatus.ts), cached and invalidated on save /
// a filesystem watcher (never per-render — a per-item `git status` call
// would be prohibitively slow on a large tree).
import * as vscode from "vscode";
import { BADGE_BY_STATUS, COLOR_ID_BY_STATUS, parsePorcelain, runGitStatus, type GitFileStatus } from "./gitStatus";

function statusMapsEqual(
  a: Map<string, GitFileStatus> | undefined,
  b: Map<string, GitFileStatus>,
): boolean {
  if (!a) return false;
  if (a.size !== b.size) return false;
  for (const [path, status] of a) {
    if (b.get(path) !== status) return false;
  }
  return true;
}

export class PaneCrewGitDecorationProvider implements vscode.FileDecorationProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeEmitter.event;

  private readonly statusByFolder = new Map<string, Map<string, GitFileStatus>>();
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.onDidChangeEmitter.fire(undefined);
  }

  async refresh(folder: vscode.WorkspaceFolder): Promise<void> {
    const root = folder.uri.fsPath.replace(/\\/g, "/");
    const output = await runGitStatus(folder.uri.fsPath);
    const next = parsePorcelain(output, root);
    const previous = this.statusByFolder.get(root);
    this.statusByFolder.set(root, next);
    // Only fire when the parsed status actually differs — `git status` runs
    // on every save/fs-watcher tick regardless of whether anything changed,
    // and an unconditional fire repaints (and visibly flashes) every
    // decorated item in every view exposing these resourceUris even when
    // nothing did.
    if (!statusMapsEqual(previous, next)) {
      this.onDidChangeEmitter.fire(undefined);
    }
  }

  async refreshAll(folders: readonly vscode.WorkspaceFolder[]): Promise<void> {
    await Promise.all(folders.map((folder) => this.refresh(folder)));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (!this.enabled) return undefined;
    const path = uri.fsPath.replace(/\\/g, "/");
    for (const statuses of this.statusByFolder.values()) {
      const status = statuses.get(path);
      if (status) {
        return {
          badge: BADGE_BY_STATUS[status],
          color: new vscode.ThemeColor(COLOR_ID_BY_STATUS[status]),
          tooltip: `PaneCrew: ${status}`,
        };
      }
    }
    return undefined;
  }
}
