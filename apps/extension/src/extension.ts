// PaneCrew extension entry point. Wires together every ported/new module:
// grid state + layout controller (1), the tree explorer + git decorations +
// search delegation (2), focus-follow (3), session persistence (4), theming
// (5), terminal links (6), snippets (7), the onboarding walkthrough (8), and
// settings (9). Kept as one file (rather than split further) because its
// entire job IS the wiring — every piece of actual logic lives in the
// modules it imports, each independently unit-tested.
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
  type TemplateId,
} from "./grid/gridState";
import { GridLayoutController } from "./grid/layoutController";
import { deletePreset, gridStateFromPreset, loadPresets, presetProjectPaths, savePreset } from "./grid/presets";
import { PaneCrewGitDecorationProvider } from "./explorer/gitDecorationProvider";
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
import { loadSession, saveSession } from "./session/persistence";
import { PaneCrewTerminalLinkProvider } from "./terminal/linkProvider";
import { registerCreateSnippetCommand, registerInsertSnippetCommand } from "./terminal/snippets";
import {
  createGridTemplateStatusBarItem,
  createNewWindowStatusBarItem,
  defaultProjectsFolderUri,
  registerSetDefaultProjectsFolderCommand,
} from "./statusBar";

let gridState: GridState = INITIAL_GRID_STATE;

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("PaneCrew");
  context.subscriptions.push(outputChannel);

  const layoutController = new GridLayoutController(vscode);
  const treeDataProvider = new PaneCrewTreeDataProvider();
  const gitDecorationProvider = new PaneCrewGitDecorationProvider();

  const refreshGitDecorations = () => {
    const enabled = vscode.workspace.getConfiguration("panecrew").get<boolean>("git.showDecorations", true);
    gitDecorationProvider.setEnabled(enabled);
    if (enabled) void gitDecorationProvider.refreshAll(vscode.workspace.workspaceFolders ?? []);
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
  context.subscriptions.push(
    vscode.window.registerTerminalLinkProvider(new PaneCrewTerminalLinkProvider()),
  );

  refreshGitDecorations();

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => { refreshGitDecorations(); }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    treeDataProvider.refresh();
    refreshGitDecorations();
  }));
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("panecrew.git.showDecorations")) refreshGitDecorations();
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
    ),
  );

  const persist = () => void saveSession(context.workspaceState, gridState);

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
    if (restored) {
      gridState = { ...INITIAL_GRID_STATE, template: restored.template, splitRatios: restored.splitRatios };
      restored.slots.forEach((slot, index) => {
        if (!slot) return;
        gridState = assignProjectToSlot(gridState, index, slot.project_path, makeId(), makeId());
      });
    }
    // Backfill any open workspace folder the restored session doesn't
    // already track (2026-08-27 fix): covers both "no session was ever
    // saved" and "the session only partially restored" — an unsaved
    // multi-root workspace's `workspaceState` isn't reliably persisted
    // across a "Developer: Reload Window", so a folder that's genuinely
    // already open must still end up with a tracked pane instead of
    // silently falling outside the grid (which previously left
    // focus-follow permanently unable to resolve it, and any later
    // add-folder attempt spawning a duplicate terminal for it).
    for (const folder of openFolders) {
      const alreadyTracked = gridState.slots.some((slot) => slot?.projectPath === folder.uri.fsPath);
      if (alreadyTracked) continue;
      const slotIndex = firstEmptySlotIndex(gridState);
      if (slotIndex === -1) break;
      gridState = assignProjectToSlot(gridState, slotIndex, folder.uri.fsPath, makeId(), makeId());
    }
    await layoutController.apply(gridState);
    persist();
  }

  // --- grid commands -----------------------------------------------------
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
    await layoutController.apply(gridState);
    treeDataProvider.refresh();
    refreshGitDecorations();
    persist();
    void maybeShowGridHint(context.globalState, gridState);
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
  context.subscriptions.push(gridTemplateStatusBarItem, createNewWindowStatusBarItem(context));
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

  // --- close-pane cleanup: forget disposed terminals so re-applying the
  // layout doesn't try to reuse a dead terminal handle -------------------
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      const pane = layoutController.paneForTerminal(terminal);
      if (!pane) return;
      layoutController.forgetPane(pane.paneId);
      gridState = closePane(gridState, pane.paneId);
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
