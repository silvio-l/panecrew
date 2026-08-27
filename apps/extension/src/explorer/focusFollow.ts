// The product's signature feature: whichever pane (terminal or tab) has
// focus, the PaneCrew explorer reveals that pane's owning workspace folder.
//
// Primary mechanism: `vscode.window.tabGroups.activeTabGroup.viewColumn` —
// VS Code always exposes which EDITOR GROUP is focused, regardless of what's
// open inside it. Since `layoutController.ts` assigns each pane to exactly
// one `ViewColumn`, mapping viewColumn -> pane resolves focus for ANY
// terminal or tab in that group, not just the one PaneCrew's own
// `ensureTerminal` created. That distinction matters in practice: PaneCrew's
// whole purpose is hosting arbitrary CLI coding agents, so a second,
// user/agent-opened terminal living in the same group as the PaneCrew one is
// the common case, not an edge case — and the previous terminal-identity-only
// lookup (`paneForTerminal`) silently no-oped for exactly that terminal.
// `onDidChangeActiveTerminal` + `paneForTerminal` is kept as a secondary
// signal for the terminal-identity case (it fires in a couple of situations
// tab-group events don't, e.g. terminal creation without a group-focus
// change), but the viewColumn path is what actually fixes the bug.
import * as vscode from "vscode";
import type { Pane } from "../grid/gridState";
import type { FolderRootItem, ProjectTreeItem } from "./treeDataProvider";

/** The minimal grid-tracking surface `layoutController.ts`'s
 * `GridLayoutController` needs to expose for focus-follow to resolve "which
 * pane has focus" — kept separate from the controller's full interface so
 * this module doesn't need to import more than it actually reads. */
export interface PaneLookup {
  /** The pane that owns a given live terminal, or `null` if the terminal
   * isn't one PaneCrew created (e.g. a terminal the user opened by hand). */
  paneForTerminal(terminal: vscode.Terminal): Pane | null;
  /** The pane assigned to a given editor group (`ViewColumn` position), or
   * `null` if that group isn't currently occupied by a pane. */
  paneForViewColumn(viewColumn: number): Pane | null;
}

function rootItemForProjectPath(
  projectPath: string,
  folders: readonly vscode.WorkspaceFolder[],
): FolderRootItem | null {
  const folder = folders.find((f) => f.uri.fsPath === projectPath);
  return folder ? { kind: "root", folder } : null;
}

/** Wires up both focus sources. Returns the disposables the caller
 * (`extension.ts`) must add to `context.subscriptions`. `log` is optional
 * diagnostic output (an `OutputChannel.appendLine`-shaped function) — every
 * branch that can silently no-op (no pane found for the terminal, no
 * workspace folder matching the pane's stored project path, no workspace
 * folder for a file's URI) logs why, since a silent no-op here is exactly
 * what makes "focus-follow doesn't work" hard to diagnose from a bug report
 * alone. */
export function registerFocusFollow(
  treeView: vscode.TreeView<ProjectTreeItem>,
  lookup: PaneLookup,
  log: (message: string) => void = () => { /* no-op default: caller opted out of diagnostics */ },
): vscode.Disposable[] {
  const revealRootForPane = (pane: Pane, source: string): boolean => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const root = rootItemForProjectPath(pane.projectPath, folders);
    if (!root) {
      log(
        `focus-follow: pane project path "${pane.projectPath}" matches no open workspace folder ` +
          `(have: ${folders.map((f) => f.uri.fsPath).join(", ") || "none"}) — reveal skipped`,
      );
      return false;
    }
    log(`focus-follow: revealing "${root.folder.name}" (${source})`);
    void treeView.reveal(root, { select: true, focus: false, expand: true });
    return true;
  };

  /** Primary path: resolve focus via the focused EDITOR GROUP, not the
   * focused tab/terminal's identity — covers any terminal or tab living in
   * that group, including ones PaneCrew didn't itself create. */
  const revealForActiveGroup = () => {
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    const pane = lookup.paneForViewColumn(activeGroup.viewColumn);
    if (!pane) {
      log(`focus-follow: active editor group (viewColumn ${activeGroup.viewColumn}) has no assigned pane — ignoring`);
      return;
    }
    revealRootForPane(pane, `active group, viewColumn ${activeGroup.viewColumn}`);
  };

  /** Secondary/fallback path: exact-terminal-identity lookup, for the rare
   * case `onDidChangeActiveTerminal` fires without an accompanying tab-group
   * change event. */
  const revealForTerminal = (terminal: vscode.Terminal | undefined) => {
    if (!terminal) {
      log("focus-follow: active terminal changed to none");
      return;
    }
    const pane = lookup.paneForTerminal(terminal);
    if (!pane) {
      log(`focus-follow: terminal "${terminal.name}" has no owning pane by identity — falling back to active-group lookup`);
      revealForActiveGroup();
      return;
    }
    revealRootForPane(pane, `terminal "${terminal.name}"`);
  };

  return [
    vscode.window.onDidChangeActiveTerminal(revealForTerminal),
    vscode.window.tabGroups.onDidChangeTabGroups(revealForActiveGroup),
    vscode.window.tabGroups.onDidChangeTabs(revealForActiveGroup),
  ];
}

