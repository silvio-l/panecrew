// The product's signature feature: whichever TAB (terminal or editor) has
// focus, the PaneCrew explorer shows ONLY that tab's own working directory's
// tree — not all open projects at once (that's a regular VS Code multi-root
// explorer; PaneCrew's whole point is narrowing to the one project you're
// currently looking at).
//
// Focus hangs off the TAB, not the pane/editor-group. A pane's `viewColumn`
// assignment only reflects which project `layoutController.ts` most recently
// put there — it goes stale the moment a tab is dragged into a different
// group (e.g. a terminal tab pulled from one pane into another pane's
// group), because dragging a tab does not change that terminal's own cwd,
// it only changes which group displays it. So resolution here always tries
// the ACTIVE TAB's own identity first:
//   - a terminal tab: resolve via `vscode.window.activeTerminal` (VS Code
//     keeps this pointed at whichever terminal tab is actually focused,
//     regardless of which group it lives in) + `paneForTerminal`, which
//     looks up that exact terminal's own project path.
//   - a file/notebook/custom-editor tab: resolve via
//     `vscode.workspace.getWorkspaceFolder(uri)` on the tab's own URI —
//     again the tab's own identity, not the group it happens to sit in.
// The viewColumn -> pane lookup (`paneForViewColumn`) is kept only as a
// last-resort fallback for tabs that carry no identity of their own (e.g. an
// empty editor group, or a settings/webview tab) — it resolves focus for
// ANY terminal or tab in that group, not just the one PaneCrew's own
// `ensureTerminal` created, which still matters since a second,
// user/agent-opened terminal living in the same group as the PaneCrew one is
// the common case, not an edge case.
import * as vscode from "vscode";
import type { Pane } from "../grid/gridState";

/** The minimal explorer surface focus-follow needs — kept separate from
 * `PaneCrewTreeDataProvider`'s full interface so this module doesn't need
 * to import the tree item types it never touches. */
export interface ExplorerFocus {
  setActiveFolder(folder: vscode.WorkspaceFolder): void;
}

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

function folderForProjectPath(
  projectPath: string,
  folders: readonly vscode.WorkspaceFolder[],
): vscode.WorkspaceFolder | null {
  return folders.find((f) => f.uri.fsPath === projectPath) ?? null;
}

/** Resolves a terminal PaneCrew didn't itself create (e.g. a task terminal,
 * or one the user opened by hand) to a workspace folder via its own live
 * cwd, instead of the group/viewColumn it happens to sit in — that group
 * membership is frequently stale or was never tracked for such terminals
 * (`paneByViewColumn` is only populated for panes the grid itself placed).
 * `shellIntegration.cwd` reflects the terminal's actual current directory
 * when shell integration is active; `creationOptions.cwd` is the fallback
 * for terminals created with an explicit starting cwd. */
function folderForTerminalCwd(terminal: vscode.Terminal): vscode.WorkspaceFolder | null {
  const creationCwd =
    "cwd" in terminal.creationOptions ? terminal.creationOptions.cwd : undefined;
  const cwd = terminal.shellIntegration?.cwd ?? creationCwd;
  if (!cwd) return null;
  const uri = cwd instanceof vscode.Uri ? cwd : vscode.Uri.file(cwd);
  return vscode.workspace.getWorkspaceFolder(uri) ?? null;
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
  explorer: ExplorerFocus,
  lookup: PaneLookup,
  log: (message: string) => void = () => { /* no-op default: caller opted out of diagnostics */ },
): vscode.Disposable[] {
  const showFolder = (folder: vscode.WorkspaceFolder, source: string): void => {
    log(`focus-follow: showing "${folder.name}" (${source})`);
    explorer.setActiveFolder(folder);
  };

  const showRootForPane = (pane: Pane, source: string): boolean => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const folder = folderForProjectPath(pane.projectPath, folders);
    if (!folder) {
      log(
        `focus-follow: pane project path "${pane.projectPath}" matches no open workspace folder ` +
          `(have: ${folders.map((f) => f.uri.fsPath).join(", ") || "none"}) — switch skipped`,
      );
      return false;
    }
    showFolder(folder, source);
    return true;
  };

  /** Fallback path: resolve focus via the focused EDITOR GROUP's pane
   * assignment — used only when the active tab itself carries no identity
   * of its own (empty group, settings/webview tab, …). Covers any terminal
   * or tab living in that group, including ones PaneCrew didn't itself
   * create. */
  const revealForActiveGroup = (): void => {
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    const pane = lookup.paneForViewColumn(activeGroup.viewColumn);
    if (!pane) {
      log(`focus-follow: active editor group (viewColumn ${activeGroup.viewColumn}) has no assigned pane — ignoring`);
      return;
    }
    showRootForPane(pane, `active group, viewColumn ${activeGroup.viewColumn}`);
  };

  /** Primary path: resolve focus via the active TAB's own identity, not the
   * editor group it currently happens to sit in — this is what keeps focus
   * follow correct after a tab is dragged from one pane's group into
   * another, since dragging a tab never changes that tab's own terminal cwd
   * or file URI, only which group displays it. */
  const revealForActiveTab = (): void => {
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    const activeTab = activeGroup.activeTab;

    if (activeTab?.input instanceof vscode.TabInputTerminal) {
      const terminal = vscode.window.activeTerminal;
      if (terminal) {
        const pane = lookup.paneForTerminal(terminal);
        if (pane) {
          showRootForPane(pane, `terminal tab "${terminal.name}"`);
          return;
        }
        const folder = folderForTerminalCwd(terminal);
        if (folder) {
          showFolder(folder, `terminal tab "${terminal.name}" (by cwd)`);
          return;
        }
        log(`focus-follow: active terminal tab "${terminal.name}" has no owning pane and no resolvable cwd — falling back to active-group lookup`);
      }
      revealForActiveGroup();
      return;
    }

    const uri =
      activeTab?.input instanceof vscode.TabInputText ||
      activeTab?.input instanceof vscode.TabInputNotebook ||
      activeTab?.input instanceof vscode.TabInputCustom
        ? activeTab.input.uri
        : undefined;
    if (uri) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (folder) {
        showFolder(folder, `file tab "${activeTab?.label}"`);
        return;
      }
      log(`focus-follow: active file tab "${activeTab?.label}" (${uri.fsPath}) matches no open workspace folder — falling back to active-group lookup`);
    }

    revealForActiveGroup();
  };

  return [
    vscode.window.onDidChangeActiveTerminal(revealForActiveTab),
    vscode.window.tabGroups.onDidChangeTabGroups(revealForActiveTab),
    vscode.window.tabGroups.onDidChangeTabs(revealForActiveTab),
  ];
}

