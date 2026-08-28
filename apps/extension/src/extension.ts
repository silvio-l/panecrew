// PaneCrew extension entry point. Wires together every ported/new module:
// grid state + layout controller (1), the tree explorer + git decorations +
// search delegation (2), focus-follow (3), session persistence (4), theming
// (5), terminal links (6), snippets (7), the onboarding walkthrough (8), and
// settings (9). Kept as one file (rather than split further) because its
// entire job IS the wiring — every piece of actual logic lives in the
// modules it imports, each independently unit-tested.
import * as path from "node:path";
import * as vscode from "vscode";
import { applyCompactLook, restoreLook } from "./compactLook";
import {
  assignProjectToSlot,
  closePane,
  firstEmptySlotIndex,
  INITIAL_GRID_STATE,
  switchTemplate,
  templateForDimensions,
  type GridState,
  type Pane,
  type TemplateId,
} from "./grid/gridState";
import { GridLayoutController } from "./grid/layoutController";
import { deletePreset, gridStateFromPreset, loadPresets, presetProjectPaths, savePreset } from "./grid/presets";
import { PaneCrewGitDecorationProvider } from "./explorer/gitDecorationProvider";
import { isGitIndexNoise } from "./git/repoStatus";
import { PaneCrewCrossRepoViewProvider } from "./git/crossRepoView";
import { formatStatusLabel, getProjectStatus } from "./git/projectStatus";
import { isGhAvailable } from "./git/forgeStatus";
import { registerFocusFollow } from "./explorer/focusFollow";
import { PaneCrewTreeDataProvider, type FileSystemEntryItem, type ProjectTreeItem } from "./explorer/treeDataProvider";
import {
  registerCopyPathCommand,
  registerDeleteEntryCommand,
  registerNewFileCommand,
  registerNewFolderCommand,
  registerRenameEntryCommand,
  registerRevealInOSCommand,
} from "./explorer/fileOperations";
import { PaneCrewDragAndDropController } from "./explorer/dragAndDrop";
import { onboardingShouldComplete } from "./onboarding/onboardingState";
import { maybeShowGridHint } from "./onboarding/gridHint";
import { maybeOfferPaneCrewTheme, registerSetThemeCommand } from "./onboarding/themeOffer";
import { maybeOfferAttentionAdapterConfig } from "./onboarding/attentionAdapterOffer";
import { loadSession, saveSession } from "./session/persistence";
import { restoreGridState } from "./session/restoreSession";
import { PaneCrewTerminalLinkProvider } from "./terminal/linkProvider";
import { registerCreateSnippetCommand, registerInsertSnippetCommand } from "./terminal/snippets";
import { AttentionTracker, createAttentionSignalBuffer, type AttentionNotification } from "./terminal/attentionSignal";
import { PaneCrewAttentionDecorationProvider } from "./explorer/attentionDecorationProvider";
import { registerConfigureCliToolNotificationsCommand } from "./terminal/cliAdapters/configureNotifications";
import {
  createGridTemplateStatusBarItem,
  createNewWindowStatusBarItem,
  createToggleSidebarStatusBarItem,
  defaultProjectsFolderUri,
  registerSetDefaultProjectsFolderCommand,
} from "./statusBar";

let gridState: GridState = INITIAL_GRID_STATE;
/** Project paths whose pane the user deliberately closed while the folder
 * stayed part of the workspace — see `session/restoreSession.ts`. */
let closedProjectPaths = new Set<string>();

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("PaneCrew");
  context.subscriptions.push(outputChannel);

  const layoutController = new GridLayoutController(vscode);
  // PaneCrew pre-builds a template's full editor-group tree (e.g. quad's
  // 2x2) up front and fills slots in one at a time as the user adds
  // folders — so most slots sit genuinely empty between adds. VS Code's own
  // `workbench.editor.closeEmptyGroups` (default true) auto-removes empty
  // groups it thinks the user no longer wants, which silently prunes those
  // still-unfilled slots and collapses the grid toward a flatter shape
  // (reproduced headless: a real 2x2 degrades to a mix of leaves/splits
  // after a few sequential adds — see
  // `src/test/gridLayoutRepro.test.ts`). PaneCrew's whole premise depends on
  // deliberately-empty groups surviving until filled, so it must own this
  // setting globally rather than leave VS Code's editing-focused default in
  // place.
  await vscode.workspace
    .getConfiguration()
    .update("workbench.editor.closeEmptyGroups", false, vscode.ConfigurationTarget.Global);
  const treeDataProvider = new PaneCrewTreeDataProvider();
  const gitDecorationProvider = new PaneCrewGitDecorationProvider();
  const attentionTracker = new AttentionTracker();
  const attentionDecorationProvider = new PaneCrewAttentionDecorationProvider(attentionTracker);

  const refreshGitDecorations = () => {
    const enabled = vscode.workspace.getConfiguration("panecrew").get<boolean>("git.showDecorations", true);
    gitDecorationProvider.setEnabled(enabled);
    if (enabled) void gitDecorationProvider.refreshAll(vscode.workspace.workspaceFolders ?? []);
  };

  const refreshAttentionBadgesEnabled = () => {
    const enabled = vscode.workspace.getConfiguration("panecrew").get<boolean>("attentionBadges.enabled", true);
    attentionDecorationProvider.setEnabled(enabled);
  };

  const treeView = vscode.window.createTreeView<ProjectTreeItem>("panecrew.explorerView", {
    treeDataProvider,
    showCollapseAll: true,
    dragAndDropController: new PaneCrewDragAndDropController(() => {
      treeDataProvider.refresh();
      refreshGitDecorations();
    }),
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(gitDecorationProvider));
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(attentionDecorationProvider));
  context.subscriptions.push(
    vscode.window.registerTerminalLinkProvider(new PaneCrewTerminalLinkProvider()),
  );

  refreshGitDecorations();
  refreshAttentionBadgesEnabled();

  // --- git forge status: branch/ahead-behind/dirty + GitHub PR/CI --------
  // .scratch/git-forge-integration. `ghAvailable` is resolved once (`gh
  // auth token` is a fixed, session-wide fact) rather than re-checked per
  // project per refresh.
  const crossRepoView = new PaneCrewCrossRepoViewProvider();
  context.subscriptions.push(
    vscode.window.createTreeView("panecrew.crossRepoView", { treeDataProvider: crossRepoView }),
  );

  // The near-invisible explorer/Projects-Overview badges alone weren't
  // enough of a signal (.scratch/pane-attention-notifications follow-up,
  // 2026-08-28) — a VS Code toast is the "at least visible within VS Code"
  // floor the badges can't guarantee on their own. Gated by the same
  // `attentionBadges.enabled` setting as the main-explorer badge, since it's
  // the umbrella toggle for this whole feature.
  const showAttentionToast = (projectPath: string, notification?: AttentionNotification) => {
    const enabled = vscode.workspace.getConfiguration("panecrew").get<boolean>("attentionBadges.enabled", true);
    if (!enabled) return;
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectPath));
    const projectName = folder?.name ?? path.basename(projectPath);
    const message = `${projectName}: ${notification?.body ?? notification?.title ?? "needs your attention"}`;
    void vscode.window.showWarningMessage(message, "Reveal").then((selection) => {
      if (selection === "Reveal" && folder) {
        void vscode.commands.executeCommand("panecrew.focusProjectInExplorer", folder);
      }
    });
  };

  const markAttention = (projectPath: string, notification?: AttentionNotification) => {
    attentionTracker.markAttention(projectPath, notification);
    attentionDecorationProvider.notifyChanged(vscode.Uri.file(projectPath));
    if (crossRepoView.setAttention(vscode.Uri.file(projectPath), true)) crossRepoView.refresh();
    showAttentionToast(projectPath, notification);
  };
  const clearAttention = (projectPath: string) => {
    if (!attentionTracker.hasAttention(projectPath)) return;
    attentionTracker.clearAttention(projectPath);
    attentionDecorationProvider.notifyChanged(vscode.Uri.file(projectPath));
    if (crossRepoView.setAttention(vscode.Uri.file(projectPath), false)) crossRepoView.refresh();
  };

  // Undeclared (not in package.json contributes, so never shown in the
  // Command Palette) test-only commands, same pattern as
  // `panecrew._internal.getExternalRefreshCount` above — let the
  // integration suite drive the exact mark/clear call sites a real OSC 9/777
  // signal reaches (.scratch/pane-attention-notifications ticket 02/03)
  // without needing a live terminal shell-integration session, which is not
  // reliably automatable headless.
  context.subscriptions.push(
    vscode.commands.registerCommand("panecrew._internal.markAttention", (projectPath: string) => {
      markAttention(projectPath);
    }),
    vscode.commands.registerCommand("panecrew._internal.clearAttention", (projectPath: string) => {
      clearAttention(projectPath);
    }),
    vscode.commands.registerCommand("panecrew._internal.hasAttention", (projectPath: string) =>
      attentionTracker.hasAttention(projectPath),
    ),
    vscode.commands.registerCommand("panecrew._internal.crossRepoDescription", (folderUri: vscode.Uri) => {
      const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.toString() === folderUri.toString());
      return folder ? crossRepoView.getTreeItem(folder).description : undefined;
    }),
    // Same "test-only, bypasses the picker" purpose as the commands above —
    // `addFolderAndAssign`'s real entry points (`panecrew.openProjectGrid` /
    // `panecrew.addFolderToGrid`) start with a modal `showOpenDialog`, which
    // an automated `@vscode/test-electron` run can't drive. This calls the
    // same `assignFolderToGrid` the picker calls, so the test exercises a
    // real, `layoutController`-tracked pane/terminal — not a bypass of the
    // attention pipeline itself, only of the folder picker.
    vscode.commands.registerCommand("panecrew._internal.addProjectToGrid", async (folderPath: string) => {
      await assignFolderToGrid(vscode.Uri.file(folderPath));
    }),
  );

  let ghAvailable = false;
  // Only fires the tree-refresh events when a status actually changed —
  // the periodic poll below runs every 60s regardless, and firing an
  // unconditional `refresh()` on every tick collapses/re-expands the
  // visible tree even when nothing changed, which reads as the explorer
  // flickering on its own.
  const refreshProjectStatuses = async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const changedFlags = await Promise.all(
      folders.map(async (folder) => {
        const status = await getProjectStatus(folder.uri.fsPath, ghAvailable);
        const treeChanged = treeDataProvider.setRootDescription(folder.uri, status ? formatStatusLabel(status) : undefined);
        const crossRepoChanged = crossRepoView.setStatus(folder.uri, status);
        return { treeChanged, crossRepoChanged };
      }),
    );
    if (changedFlags.some((f) => f.treeChanged)) treeDataProvider.refresh();
    if (changedFlags.some((f) => f.crossRepoChanged)) crossRepoView.refresh();
  };
  void isGhAvailable().then((available) => {
    ghAvailable = available;
    void refreshProjectStatuses();
  });
  void refreshProjectStatuses();
  const projectStatusInterval = setInterval(() => { void refreshProjectStatuses(); }, 60_000);
  context.subscriptions.push({ dispose: () => { clearInterval(projectStatusInterval); } });
  context.subscriptions.push(
    vscode.commands.registerCommand("panecrew.focusProjectInExplorer", async (folder: vscode.WorkspaceFolder) => {
      treeDataProvider.setActiveFolder(folder);
      await vscode.commands.executeCommand("panecrew.explorerView.focus");
    }),
  );

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => { refreshGitDecorations(); }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    treeDataProvider.refresh();
    // A removed folder never gets a fresh `getProjectStatus` call from
    // `refreshProjectStatuses` (it only iterates *current* folders), so
    // that alone wouldn't fire `crossRepoView.refresh()` — without this,
    // a folder removed some other way than "Remove Project…" above (e.g.
    // VS Code's own "Remove Folder from Workspace") would keep showing a
    // stale row in Projects Overview until something unrelated changed.
    crossRepoView.refresh();
    refreshGitDecorations();
    void refreshProjectStatuses();
  }));

  // `onDidSaveTextDocument` above only covers edits made through VS Code's
  // own editor. Anything that touches the filesystem another way — a CLI
  // agent running in a pane, `git commit`/`checkout` in a terminal, another
  // process — needs a real filesystem watcher, or the explorer and git
  // decorations only ever update on the next manual "Refresh Explorer".
  // A bare glob string (rather than a RelativePattern) applies across every
  // workspace folder and honors `files.watcherExclude` automatically, same
  // as VS Code's own Explorer. Debounced because a single `git checkout` or
  // bulk delete fires a burst of events for what is conceptually one change.
  const fsWatcher = vscode.workspace.createFileSystemWatcher("**/*");
  let externalChangeTimer: ReturnType<typeof setTimeout> | undefined;
  // Exposed only via an undeclared (not in package.json contributes, so it
  // never shows in the Command Palette) command so the integration test
  // suite can observe that an external filesystem change actually reached
  // the watcher and fired a refresh, rather than trusting the wiring
  // untested — this is the one behavior `onDidSaveTextDocument` can't cover.
  let externalRefreshCount = 0;
  const scheduleExternalRefresh = (uri: vscode.Uri) => {
    // `git status` itself rewrites `.git/index` (refreshing its cached stat
    // info) even when nothing actually changed — without this guard, every
    // refresh's own `git status` call (refreshGitDecorations,
    // refreshProjectStatuses) re-triggers this exact watcher, which
    // schedules another refresh, which runs `git status` again, forever:
    // a self-sustaining loop that reads as the explorer constantly
    // flickering/reloading. `.git/HEAD` and `.git/refs/**` (real commits,
    // checkouts, branch switches) are deliberately NOT filtered — those
    // still need to trigger a refresh, and don't change on a plain
    // `git status` read.
    if (isGitIndexNoise(uri.path)) return;
    if (externalChangeTimer) clearTimeout(externalChangeTimer);
    externalChangeTimer = setTimeout(() => {
      externalChangeTimer = undefined;
      externalRefreshCount++;
      treeDataProvider.refresh();
      refreshGitDecorations();
      void refreshProjectStatuses();
    }, 300);
  };
  context.subscriptions.push(
    fsWatcher,
    fsWatcher.onDidCreate(scheduleExternalRefresh),
    fsWatcher.onDidDelete(scheduleExternalRefresh),
    fsWatcher.onDidChange(scheduleExternalRefresh),
    { dispose: () => { if (externalChangeTimer) clearTimeout(externalChangeTimer); } },
    vscode.commands.registerCommand("panecrew._internal.getExternalRefreshCount", () => externalRefreshCount),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("panecrew.git.showDecorations")) refreshGitDecorations();
      if (e.affectsConfiguration("panecrew.attentionBadges.enabled")) refreshAttentionBadgesEnabled();
    }),
  );

  // --- adopt terminals opened outside PaneCrew's own creation flow (e.g. a
  // second terminal opened via the terminal tab bar's native "+" button,
  // inside a pane's editor group) into that pane, so the attention hook
  // below and focus-follow's primary path treat it as managed instead of
  // silently ignoring it forever. Registered before `registerFocusFollow`
  // so its own `onDidChangeActiveTerminal` listener sees the adoption on
  // the very same event tick rather than falling back to its cwd-based
  // path.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!terminal) return;
      if (layoutController.paneForTerminal(terminal)) return;
      const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
      const pane = layoutController.paneForViewColumn(viewColumn);
      if (!pane) return;
      layoutController.adoptForeignTerminal(terminal, pane);
      outputChannel.appendLine(
        `attention: adopted terminal "${terminal.name}" into pane "${pane.projectPath}" (opened outside PaneCrew, e.g. via the terminal tab bar's "+" button)`,
      );
    }),
  );

  // --- pane attention notifications (.scratch/pane-attention-notifications,
  // ticket 02) — scans each terminal's own output stream for an OSC 9 /
  // OSC 777 "notify" escape sequence via the Terminal Shell Integration API,
  // protocol-level and tool-agnostic (no heuristic text parsing). Buffered
  // per-execution so a sequence split across output chunks is still caught.
  context.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution((e) => {
      const pane = layoutController.paneForTerminal(e.terminal);
      // A shell command run in a terminal PaneCrew never assigned to a pane
      // (e.g. one the user opened by hand, outside "Add Folder to Grid…")
      // can never surface an attention signal — logged so a report of "no
      // toast appeared" can be told apart from a real detection bug (see
      // the "real OSC 9 escape sequence..." integration test, which proves
      // the parse/mark path itself works once a terminal IS a tracked pane).
      if (!pane) {
        outputChannel.appendLine(`attention: ignoring shell execution on untracked terminal "${e.terminal.name}"`);
        return;
      }
      const buffer = createAttentionSignalBuffer();
      void (async () => {
        for await (const chunk of e.execution.read()) {
          for (const notification of buffer.feed(chunk)) {
            outputChannel.appendLine(`attention: notification detected for "${pane.projectPath}"`);
            markAttention(pane.projectPath, notification);
          }
        }
      })();
    }),
  );

  context.subscriptions.push(
    ...registerFocusFollow(
      treeDataProvider,
      {
        paneForTerminal: (t) => layoutController.paneForTerminal(t),
        paneForViewColumn: (c) => layoutController.paneForViewColumn(c),
      },
      (message) => { outputChannel.appendLine(message); },
      (folder) => { clearAttention(folder.uri.fsPath); },
    ),
  );

  const persist = () => void saveSession(context.workspaceState, gridState, [...closedProjectPaths]);

  // --- default template from settings -------------------------------------
  // Only takes effect when there's no restored session below to override it
  // — panecrew.grid.defaultColumns/defaultRows describe a *new* grid's
  // starting shape, not a standing override of whatever was last saved.
  const gridConfig = vscode.workspace.getConfiguration("panecrew.grid");
  gridState = switchTemplate(
    gridState,
    templateForDimensions(gridConfig.get<number>("defaultColumns", 2), gridConfig.get<number>("defaultRows", 2)),
  );

  // --- session restore -------------------------------------------------
  const restored = loadSession(context.workspaceState);
  const openFolders = vscode.workspace.workspaceFolders ?? [];
  if (openFolders.length > 0) {
    const result = restoreGridState(
      restored,
      openFolders.map((f) => f.uri.fsPath),
      makeId,
    );
    gridState = result.gridState;
    closedProjectPaths = result.closedProjectPaths;
    await layoutController.apply(gridState);
    persist();
    logAdoptedPanes(layoutController.adoptedPaneIds());
  }

  // Terminals VS Code revives from a persisted session (e.g. after
  // "Developer: Reload Window") come back with their content intact, but
  // attention tracking does NOT recover on its own in the common case: a CLI
  // agent's own foreground process (e.g. `claude`) is still the one,
  // already-running shell command from before the reload, and
  // `onDidStartTerminalShellExecution` only fires for a NEW command start --
  // typing more input into that still-running TUI never fires it again. VS
  // Code's stable extension API has no way to attach to an already-started
  // command's live output (the old proposed `onDidWriteTerminalData` API was
  // never stabilized, for terminal-secrets reasons), so there is no
  // API-level way to regain tracking without ending and restarting that
  // command. This is deliberately just a log line, not a user-facing prompt:
  // proactively warning on every reload would be noisy, and the pane's
  // content/scrollback is still intact and usable even without attention
  // tracking. `panecrew.restartPaneTerminal` is the actual fix for a pane
  // whose attention notifications stay stuck after adoption -- it ends the
  // old command and starts a fresh one, which VS Code's shell integration
  // does see as a new start. Since adoption breaks tracking in the *common*
  // case, not a rare one (confirmed 2026-08-28), this is surfaced as an
  // actionable toast with a one-click restart button rather than only a log
  // line -- the user asked specifically not to need the Command Palette or a
  // keybinding for this. One toast per activation, listing every adopted
  // pane; dismissing it (no click) leaves everything as-is, same as before.
  function logAdoptedPanes(adoptedPaneIds: readonly string[]): void {
    if (adoptedPaneIds.length === 0) return;
    const adoptedPanes = gridState.slots.filter(
      (pane): pane is Pane => pane !== null && adoptedPaneIds.includes(pane.paneId),
    );
    for (const pane of adoptedPanes) {
      outputChannel.appendLine(`attention: adopted (revived) terminal for "${pane.projectPath}" on this activation`);
    }
    const plural = adoptedPanes.length === 1 ? "pane" : "panes";
    void vscode.window
      .showWarningMessage(
        `PaneCrew: attention notifications won't fire for ${adoptedPanes.length} restored ${plural} until its terminal is fully restarted -- this ends whatever's currently running there (e.g. an in-progress CLI agent session) and starts a clean shell.`,
        "Restart Terminal(s)",
      )
      .then((choice) => {
        if (choice !== "Restart Terminal(s)") return;
        for (const pane of adoptedPanes) restartPaneTerminal(pane);
      });
  }

  function restartPaneTerminal(pane: Pane): void {
    const slotIndex = gridState.slots.findIndex((slot) => slot?.paneId === pane.paneId);
    if (slotIndex === -1) return;
    layoutController.restartTerminalForPane(pane, slotIndex + 1);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("panecrew.restartPaneTerminal", async () => {
      const panes = gridState.slots.filter((pane): pane is Pane => pane !== null);
      if (panes.length === 0) return;
      const label = (pane: Pane) => pane.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? pane.projectPath;
      const picks = await vscode.window.showQuickPick(
        panes.map((pane) => ({ label: label(pane), description: pane.projectPath, pane })),
        {
          canPickMany: true,
          placeHolder: "Select panes to fully restart (ends whatever's currently running there and starts a clean shell)",
        },
      );
      if (!picks || picks.length === 0) return;
      for (const pick of picks) restartPaneTerminal(pick.pane);
    }),
  );

  // Shared by both single-terminal restart entry points below: resolves the
  // pane for a given terminal, confirms, then restarts it. A pane's editor
  // group can hold more than one terminal tab (e.g. the user split/added an
  // extra one by hand -- PaneCrew's grid itself only ever tracks one
  // terminal per pane, see `terminalsByPaneId`), so `paneForTerminal`
  // returning `null` for an untracked terminal is the correct, safe outcome
  // here, not a bug -- it means "not a PaneCrew pane terminal", not "no
  // pane found for this pane".
  async function confirmAndRestart(terminal: vscode.Terminal | undefined): Promise<void> {
    const pane = terminal ? layoutController.paneForTerminal(terminal) : null;
    if (!pane) {
      void vscode.window.showWarningMessage("PaneCrew: this isn't a PaneCrew pane terminal.");
      return;
    }
    const label = pane.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? pane.projectPath;
    const choice = await vscode.window.showWarningMessage(
      `Restart the terminal for "${label}"? This ends whatever's currently running there and starts a clean shell.`,
      { modal: true },
      "Restart",
    );
    if (choice !== "Restart") return;
    restartPaneTerminal(pane);
  }

  // Editor-tab icon (visible on the pane's own tab, next to "Toggle Maximize
  // Pane" -- see the matching `editor/title` entry in package.json), so
  // restarting one specific pane's terminal never needs the Command Palette
  // or the multi-select quick pick above. Resolves the target pane from
  // `vscode.window.activeTerminal` since editor-tab terminals (this grid's
  // `location: { viewColumn }` terminals) don't carry a `resource` URI the
  // way file editors do -- the icon only shows on a terminal tab in the
  // first place (`resourceScheme == vscode-terminal`), and that tab being
  // active is what makes it the active terminal. When a pane has more than
  // one terminal tab, this acts on whichever one is currently focused/shown
  // -- `panecrew.restartPaneTerminalInstance` (below) is the alternative for
  // targeting one specific terminal directly, active or not.
  context.subscriptions.push(
    vscode.commands.registerCommand("panecrew.restartActivePaneTerminal", () =>
      confirmAndRestart(vscode.window.activeTerminal),
    ),
  );

  // Right-click-inside-the-terminal context menu entry (see `terminal/context`
  // in package.json) -- VS Code passes the exact terminal instance the user
  // clicked as the argument here (not just "whichever tab is active"), so
  // this is the reliable way to target one specific terminal when a pane
  // has several terminal tabs open side by side.
  context.subscriptions.push(
    vscode.commands.registerCommand("panecrew.restartPaneTerminalInstance", (terminal?: vscode.Terminal) =>
      confirmAndRestart(terminal ?? vscode.window.activeTerminal),
    ),
  );

  // --- grid commands -----------------------------------------------------
  async function assignFolderToGrid(folderUri: vscode.Uri): Promise<void> {
    const existingFolders = vscode.workspace.workspaceFolders ?? [];
    const alreadyInWorkspace = existingFolders.some((f) => f.uri.fsPath === folderUri.fsPath);
    if (!alreadyInWorkspace) {
      vscode.workspace.updateWorkspaceFolders(existingFolders.length, 0, { uri: folderUri });
    }

    const slotIndex = firstEmptySlotIndex(gridState);
    if (slotIndex === -1) {
      void vscode.window.showWarningMessage(
        "PaneCrew: the current grid template is full. Switch to a larger template or close a pane first.",
      );
      return;
    }
    gridState = assignProjectToSlot(gridState, slotIndex, folderUri.fsPath, makeId(), makeId());
    closedProjectPaths.delete(folderUri.fsPath);
    await layoutController.apply(gridState);
    treeDataProvider.refresh();
    refreshGitDecorations();
    persist();
    void maybeShowGridHint(context.globalState, gridState);
  }

  async function addFolderAndAssign(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Add to PaneCrew Grid",
      defaultUri: defaultProjectsFolderUri(),
    });
    const folderUri = picked?.[0];
    if (!folderUri) return;
    await assignFolderToGrid(folderUri);
  }

  // --- status bar: grid template picker + new-window shortcut ------------
  // Stand-in for the title-bar controls the old desktop app had — an
  // extension has no API to add anything to VS Code's native title bar.
  const gridTemplateStatusBarItem = createGridTemplateStatusBarItem(context, gridState.template, (template: TemplateId) => {
    gridState = switchTemplate(gridState, template);
    gridTemplateStatusBarItem.setTemplate(gridState.template);
    void layoutController.apply(gridState);
    treeDataProvider.refresh();
    refreshGitDecorations();
    persist();
  });
  context.subscriptions.push(
    gridTemplateStatusBarItem,
    createNewWindowStatusBarItem(context),
    createToggleSidebarStatusBarItem(),
  );
  registerSetDefaultProjectsFolderCommand(context);

  context.subscriptions.push(
    // Same handler as "Add Folder to Grid…" — "Open Project Grid…" is the
    // advertised first-run entry point (viewsWelcome, walkthrough, docs);
    // once a grid exists, adding a folder *is* how you grow it further, so
    // both titles map onto one implementation rather than diverging logic.
    vscode.commands.registerCommand("panecrew.openProjectGrid", addFolderAndAssign),
    vscode.commands.registerCommand("panecrew.addFolderToGrid", addFolderAndAssign),
    vscode.commands.registerCommand("panecrew.refreshExplorer", () => {
      treeDataProvider.refresh();
      refreshGitDecorations();
    }),
    vscode.commands.registerCommand("panecrew.toggleSidebar", () =>
      vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility"),
    ),
    // Projects Overview's context menu (.scratch/git-forge-integration) —
    // the counterpart to "Add Folder to Grid…": closes the project's pane
    // (if it has one) and drops the folder from the multi-root workspace.
    // Never touches anything on disk.
    vscode.commands.registerCommand("panecrew.removeProjectFromWorkspace", async (folder: vscode.WorkspaceFolder | undefined) => {
      if (!folder) return;
      const confirmed = await vscode.window.showWarningMessage(
        `Remove "${folder.name}" from this PaneCrew workspace?`,
        { modal: true, detail: "Its pane closes and the folder leaves the workspace — files on disk are untouched." },
        "Remove",
      );
      if (confirmed !== "Remove") return;

      const pane = gridState.slots.find((slot) => slot?.projectPath === folder.uri.fsPath);
      if (pane) {
        layoutController.disposeTerminalForPane(pane.paneId);
        gridState = closePane(gridState, pane.paneId);
        await layoutController.apply(gridState);
      }
      // Leaving the workspace entirely, not merely closing its pane — this
      // folder won't be in `openFolders` on the next activation either way,
      // so it shouldn't linger in `closedProjectPaths`.
      closedProjectPaths.delete(folder.uri.fsPath);

      const existingFolders = vscode.workspace.workspaceFolders ?? [];
      const index = existingFolders.findIndex((f) => f.uri.toString() === folder.uri.toString());
      if (index !== -1) vscode.workspace.updateWorkspaceFolders(index, 1);

      crossRepoView.refresh();
      treeDataProvider.refresh();
      refreshGitDecorations();
      persist();
    }),
    // Quick Pane Maximize Toggle (.scratch/pane-attention-notifications,
    // ticket 01) — a thin wrapper around VS Code's own native command, shown
    // only on terminal editor tabs (package.json's editor/title `when`).
    vscode.commands.registerCommand("panecrew.toggleMaximizePane", () =>
      vscode.commands.executeCommand("workbench.action.toggleMaximizeEditorGroup"),
    ),
  );

  // --- compact look --------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("panecrew.applyCompactLook", () => applyCompactLook(context.workspaceState)),
    vscode.commands.registerCommand("panecrew.restoreLook", () => restoreLook(context.workspaceState)),
  );

  // --- presets ---------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("panecrew.savePreset", async () => {
      const name = await vscode.window.showInputBox({ prompt: "Name this grid preset" });
      if (!name) return;
      await savePreset(context.globalState, name, gridState);
      void vscode.window.showInformationMessage(`PaneCrew: saved preset "${name}".`);
    }),
    vscode.commands.registerCommand("panecrew.loadPreset", async () => {
      const presets = loadPresets(context.globalState);
      if (presets.length === 0) {
        void vscode.window.showInformationMessage("PaneCrew: no saved presets yet.");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        presets.map((p) => ({ label: p.name, preset: p })),
        { placeHolder: "Choose a grid preset to load" },
      );
      if (!picked) return;

      const existingFolders = vscode.workspace.workspaceFolders ?? [];
      const missing = presetProjectPaths(picked.preset).filter(
        (path) => !existingFolders.some((f) => f.uri.fsPath === path),
      );
      if (missing.length > 0) {
        vscode.workspace.updateWorkspaceFolders(
          existingFolders.length,
          0,
          ...missing.map((path) => ({ uri: vscode.Uri.file(path) })),
        );
      }

      gridState = gridStateFromPreset(picked.preset, makeId);
      await layoutController.apply(gridState);
      treeDataProvider.refresh();
      refreshGitDecorations();
      persist();
    }),
    vscode.commands.registerCommand("panecrew.deletePreset", async () => {
      const presets = loadPresets(context.globalState);
      const picked = await vscode.window.showQuickPick(presets.map((p) => p.name));
      if (picked) await deletePreset(context.globalState, picked);
    }),
  );

  // --- search delegation (item 2) --------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("panecrew.searchInFolder", async (item: FileSystemEntryItem | undefined) => {
      if (!item) return;
      const relative = vscode.workspace.asRelativePath(item.uri, false);
      await vscode.commands.executeCommand("workbench.action.findInFiles", {
        query: "",
        filesToInclude: relative,
      });
    }),
  );

  // --- file operations (rename, new file/folder, delete) -----------------
  const onExplorerFilesChanged = () => { treeDataProvider.refresh(); refreshGitDecorations(); };
  context.subscriptions.push(
    registerRenameEntryCommand(onExplorerFilesChanged),
    registerNewFileCommand(onExplorerFilesChanged),
    registerNewFolderCommand(onExplorerFilesChanged),
    registerDeleteEntryCommand(onExplorerFilesChanged),
    registerCopyPathCommand(),
    registerRevealInOSCommand(),
  );

  // --- snippets ----------------------------------------------------------
  context.subscriptions.push(registerInsertSnippetCommand(context), registerCreateSnippetCommand(context));

  // --- theming -------------------------------------------------------------
  context.subscriptions.push(registerSetThemeCommand());
  void maybeOfferPaneCrewTheme(context.globalState);

  // --- CLI tool attention adapters (.scratch/pane-attention-notifications,
  // tickets 04-06) -----------------------------------------------------------
  context.subscriptions.push(registerConfigureCliToolNotificationsCommand(context));
  void maybeOfferAttentionAdapterConfig(context.globalState);

  // --- close-pane cleanup: forget disposed terminals so re-applying the
  // layout doesn't try to reuse a dead terminal handle -------------------
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      const pane = layoutController.paneForTerminal(terminal);
      if (!pane) return;
      layoutController.forgetPane(pane.paneId);
      gridState = closePane(gridState, pane.paneId);
      closedProjectPaths.add(pane.projectPath);
      clearAttention(pane.projectPath);
      persist();
    }),
  );

  // --- onboarding completion (no explicit UI action needed — the
  // walkthrough's own completionEvents in package.json handle per-step
  // completion; this only needs to exist so `onboardingShouldComplete` has a
  // real call site ported from the desktop app's own Aha-Moment tracking) --
  if (onboardingShouldComplete(gridState)) {
    await context.globalState.update("panecrew.onboardingComplete", true);
  }

  // --- surface the walkthrough on first activation --------------------
  // The walkthrough is discoverable via VS Code's own Welcome page and the
  // Command Palette, but neither is somewhere a first-time user reliably
  // looks — opening it once, on the very first activation, is what actually
  // gets it seen.
  if (!context.globalState.get<boolean>("panecrew.walkthroughShown")) {
    await context.globalState.update("panecrew.walkthroughShown", true);
    void vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      "silvio-lindstedt.panecrew#panecrew.gettingStarted",
    );
  }
}

export function deactivate(): void {
  // No explicit teardown needed: every registration above is disposed via
  // `context.subscriptions`, and VS Code itself tears down any terminals
  // this extension created along with the extension host.
}
