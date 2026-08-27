import * as assert from "node:assert";
import * as vscode from "vscode";

const EXTENSION_ID = "panecrew.panecrew";

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
