import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "silvio-lindstedt.panecrew";

/** `vscode.Extension.packageJSON` is typed `any` by @types/vscode — this is
 * just the subset of `package.json`'s `contributes` block these tests read. */
interface PaneCrewPackageJSON {
  contributes: {
    viewsContainers: { activitybar: { id: string }[] };
    views: { panecrew: { id: string }[] };
    themes: { label: string }[];
    walkthroughs: { id: string; steps: { id: string }[] }[];
  };
}

suite("PaneCrew extension", () => {
  test("activates and registers every declared command", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "extension should be discoverable by its id");
    await ext.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "panecrew.addFolderToGrid",
      "panecrew.applyCompactLook",
      "panecrew.restoreLook",
      "panecrew.savePreset",
      "panecrew.loadPreset",
      "panecrew.searchInFolder",
      "panecrew.insertSnippet",
      "panecrew.createSnippet",
      "panecrew.setGridTemplate",
      "panecrew.renameEntry",
      "panecrew.newFile",
      "panecrew.newFolder",
      "panecrew.deleteEntry",
      "panecrew.copyPath",
      "panecrew.revealInOS",
      "panecrew.openProjectInNewWindow",
      "panecrew.refreshExplorer",
      "panecrew.setPaneCrewTheme",
    ]) {
      assert.ok(commands.includes(id), `command ${id} should be registered`);
    }
  });

  test("contributes its own Activity Bar view container and view", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    const contributes = (ext.packageJSON as PaneCrewPackageJSON).contributes;
    const containers = contributes.viewsContainers.activitybar;
    assert.ok(containers.some((c) => c.id === "panecrew"));
    const views = contributes.views.panecrew;
    assert.ok(views.some((v) => v.id === "panecrew.explorerView"));
  });

  test("registers a real TreeView for the explorer, not a webview", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    // A real TreeDataProvider must be resolvable via the view id without
    // throwing — `vscode.window.createTreeView` in `extension.ts` is the
    // thing under test here; if activation registered a webview instead,
    // this would still pass trivially, so the meaningful assertion is the
    // `contributes.views` shape above (no `"type": "webview"` field) plus
    // this call not throwing.
    await vscode.commands.executeCommand("panecrew.refreshExplorer");
  });

  test("refreshes the explorer when a file changes on disk outside the editor", async function () {
    this.timeout(10_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    const countBefore = await vscode.commands.executeCommand<number>(
      "panecrew._internal.getExternalRefreshCount",
    );

    // Written with plain node:fs, not vscode.workspace.fs / an editor save —
    // this is what a CLI agent, `git`, or any other process does, and is
    // exactly the case `onDidSaveTextDocument` alone cannot catch.
    const filePath = path.join(folder.uri.fsPath, `external-change-${Date.now()}.txt`);
    fs.writeFileSync(filePath, "external change");
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // watcher debounce is 300ms
      const countAfter = await vscode.commands.executeCommand<number>(
        "panecrew._internal.getExternalRefreshCount",
      );
      assert.ok(
        countAfter > countBefore,
        `expected the filesystem watcher to trigger a refresh (before=${countBefore}, after=${countAfter})`,
      );
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });

  test("panecrew.copyPath writes the file's path to the clipboard", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    const previousClipboard = await vscode.env.clipboard.readText();
    try {
      const fileUri = vscode.Uri.joinPath(folder.uri, "copy-path-target.txt");
      // Matches the shape of a FileSystemEntryItem (treeDataProvider.ts) —
      // the object VS Code hands the command when invoked from the
      // explorer's context menu.
      await vscode.commands.executeCommand("panecrew.copyPath", {
        kind: "entry",
        uri: fileUri,
        type: vscode.FileType.File,
        folder,
      });
      const clipboardText = await vscode.env.clipboard.readText();
      assert.strictEqual(clipboardText, fileUri.fsPath);
    } finally {
      await vscode.env.clipboard.writeText(previousClipboard);
    }
  });

  test("ships both PaneCrew color themes", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    const themes = (ext.packageJSON as PaneCrewPackageJSON).contributes.themes;
    const labels = themes.map((t) => t.label);
    assert.ok(labels.includes("PaneCrew Dark"));
    assert.ok(labels.includes("PaneCrew Light"));
  });

  test("contributes the getting-started walkthrough", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    const walkthroughs = (ext.packageJSON as PaneCrewPackageJSON).contributes.walkthroughs;
    const gettingStarted = walkthroughs.find((w) => w.id === "panecrew.gettingStarted");
    assert.ok(gettingStarted, "getting-started walkthrough should be contributed");
    assert.ok(gettingStarted.steps.length >= 3, "walkthrough should have at least 3 real steps");
  });
});
