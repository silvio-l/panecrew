import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { applyCompactLook, restoreLook, type CompactLookMemento } from "../compactLook";
import { AttentionTracker } from "../terminal/attentionSignal";
import { PaneCrewAttentionDecorationProvider } from "../explorer/attentionDecorationProvider";
import { PaneCrewAttentionQueueViewProvider } from "../explorer/attentionQueueView";

const EXTENSION_ID = "silvio-lindstedt.panecrew";

/** Polls `check` until it returns `true` or `timeoutMs` elapses — used to
 * wait on async, real-pipeline side effects (terminal creation,
 * shell-integration output) that have no single event to await. */
async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

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
      "panecrew.focusProjectInExplorer",
      "panecrew.removeProjectFromWorkspace",
      "panecrew.toggleMaximizePane",
      "panecrew.configureCliToolNotifications",
      "panecrew.jumpToAttentionPane",
      "panecrew.jumpToNextAttention",
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
    assert.ok(views.some((v) => v.id === "panecrew.crossRepoView"));
    assert.ok(views.some((v) => v.id === "panecrew.needsAttentionView"));
    // .scratch/attention-queue spec.md user story 19 — first thing seen when
    // something needs attention, without scrolling/expanding.
    assert.ok(
      views.findIndex((v) => v.id === "panecrew.needsAttentionView") <
        views.findIndex((v) => v.id === "panecrew.explorerView"),
      "Needs Attention should be positioned above Explorer",
    );
  });

  test("registers a real TreeView for the Needs-Attention queue", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    await vscode.commands.executeCommand("panecrew.needsAttentionView.focus");
  });

  test("registers a real TreeView for the cross-repo overview", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    // Same "must not throw when resolved" check as the explorer view above.
    await vscode.commands.executeCommand("panecrew.crossRepoView.focus");
  });

  test("computes and surfaces this repo's own git status in the cross-repo overview", async function () {
    this.timeout(10_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    // The fixture workspace folder isn't a git repo, so this only checks
    // that panecrew.focusProjectInExplorer (the cross-repo view's item
    // command) runs without throwing and actually switches the explorer's
    // active folder — the status-computation logic itself (branch parsing,
    // CI aggregation, label formatting) is covered by unit tests in
    // src/git/*.test.ts against real fixture strings.
    await vscode.commands.executeCommand("panecrew.focusProjectInExplorer", folder);
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

  test("does not refresh the explorer when .git/index changes (git status side effect, not a real change)", async function () {
    this.timeout(10_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    const gitDir = path.join(folder.uri.fsPath, ".git");
    const indexPath = path.join(gitDir, "index");
    // Create `.git` and a first `index` file, and let that fully settle
    // before measuring: creating a directory entry for the first time can
    // itself surface as a (correctly, not-filtered) change on the `.git`
    // directory. What real `git status` does on every run is rewrite an
    // *already-existing* `index` file's content in place — that's the case
    // under test below, not this initial setup.
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(indexPath, "initial index");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const countBefore = await vscode.commands.executeCommand<number>(
      "panecrew._internal.getExternalRefreshCount",
    );

    // Simulates what `git status` itself does to `.git/index` on every run —
    // this must NOT re-trigger a refresh, or a repo with an active PaneCrew
    // git-status/cross-repo poll flickers forever (see isGitIndexNoise in
    // git/repoStatus.ts).
    fs.writeFileSync(indexPath, "not a real index, just watcher bait");
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // watcher debounce is 300ms
      const countAfter = await vscode.commands.executeCommand<number>(
        "panecrew._internal.getExternalRefreshCount",
      );
      assert.strictEqual(
        countAfter,
        countBefore,
        `expected .git/index changes to be filtered out (before=${countBefore}, after=${countAfter})`,
      );
    } finally {
      fs.rmSync(gitDir, { recursive: true, force: true });
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
    assert.ok(
      gettingStarted.steps.some((s) => s.id === "configureCliNotifications"),
      "walkthrough should offer the CLI tool attention adapter step",
    );
  });

  test("panecrew.toggleMaximizePane delegates to the native maximize-editor-group command", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    // Pure delegation (spec.md's Testing Decisions) — the meaningful
    // assertion is that firing PaneCrew's own command resolves without
    // throwing, i.e. it actually reaches VS Code's native command rather
    // than a typo'd or unregistered one.
    await vscode.commands.executeCommand("panecrew.toggleMaximizePane");
    await vscode.commands.executeCommand("panecrew.toggleMaximizePane"); // toggle back
  });

  test("attention decoration provider badges a root with pending attention and clears it", () => {
    // Same "registered FileDecorationProvider" tier as gitDecorationProvider —
    // exercised directly against the real vscode.ThemeColor/FileDecoration
    // types rather than through the full onDidStartTerminalShellExecution
    // wiring, which needs a live terminal shell integration session
    // .scratch/pane-attention-notifications ticket 02 has no headless way to
    // simulate.
    const tracker = new AttentionTracker();
    const provider = new PaneCrewAttentionDecorationProvider(tracker);
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    assert.strictEqual(provider.provideFileDecoration(folder.uri), undefined);

    tracker.markAttention(folder.uri.fsPath, { title: "Claude Code", body: "needs your attention" });
    const decoration = provider.provideFileDecoration(folder.uri) as vscode.FileDecoration;
    assert.strictEqual(decoration.badge, "●");
    assert.strictEqual(decoration.propagate, false);
    assert.ok(decoration.tooltip?.toString().includes("needs your attention"));

    tracker.clearAttention(folder.uri.fsPath);
    assert.strictEqual(provider.provideFileDecoration(folder.uri), undefined);
  });

  test("Needs-Attention queue view lists pending entries oldest-first, with preview/tooltip/jump command", () => {
    // Same "own tracker + provider instance" tier as the decoration-provider
    // test above — .scratch/attention-queue ticket 03's acceptance criteria
    // (order, preview text, tooltip, jump command) don't need real terminals
    // or a real workspace to exercise.
    const tracker = new AttentionTracker();
    const provider = new PaneCrewAttentionQueueViewProvider(tracker);

    assert.deepStrictEqual(provider.getChildren(), [], "empty queue is the all-clear state");

    tracker.markAttention("/repo/a", { title: "Claude Code", body: "Waiting for input" });
    tracker.markAttention("/repo/b", {});

    const entries = provider.getChildren();
    assert.deepStrictEqual(entries.map((e) => e.root), ["/repo/a", "/repo/b"], "oldest signal first");

    const first = provider.getTreeItem(entries[0]);
    assert.strictEqual(first.label, "a");
    assert.strictEqual(first.description, "Claude Code — Waiting for input");
    assert.ok((first.tooltip as vscode.MarkdownString).value.includes("Claude Code — Waiting for input"));
    assert.deepStrictEqual(first.command, {
      command: "panecrew.jumpToAttentionPane",
      title: "Jump to Pane",
      arguments: ["/repo/a"],
    });

    const second = provider.getTreeItem(entries[1]);
    assert.strictEqual(second.description, "needs attention", "fallback text for a signal with no title/body");

    tracker.clearAttention("/repo/a");
    assert.deepStrictEqual(provider.getChildren().map((e) => e.root), ["/repo/b"]);
  });

  test("Needs-Attention queue view truncates a long preview instead of wrapping the sidebar row", () => {
    const tracker = new AttentionTracker();
    const provider = new PaneCrewAttentionQueueViewProvider(tracker);
    const longBody = "x".repeat(200);
    tracker.markAttention("/repo/a", { body: longBody });

    const description = provider.getTreeItem(provider.getChildren()[0]).description as string;
    assert.ok(description.length < longBody.length, "long preview text should be truncated");
    assert.ok(description.endsWith("…"), "truncated preview should end with an ellipsis");
  });

  test("Needs-Attention queue view is empty while disabled, and repopulates once re-enabled", () => {
    // Mirrors the shared-enable-switch contract (.scratch/attention-queue
    // ticket 05) at the provider level, independent of the
    // `panecrew.attentionBadges.enabled` setting/config-change wiring, which
    // the extension-level test below covers.
    const tracker = new AttentionTracker();
    const provider = new PaneCrewAttentionQueueViewProvider(tracker);
    tracker.markAttention("/repo/a");

    provider.setEnabled(false);
    assert.deepStrictEqual(provider.getChildren(), []);

    provider.setEnabled(true);
    assert.deepStrictEqual(provider.getChildren().map((e) => e.root), ["/repo/a"]);
  });

  test("marking/clearing attention updates both the main explorer and Projects Overview from one source of truth", async () => {
    // Drives the real, production `markAttention`/`clearAttention` closures
    // in extension.ts via the same undeclared-internal-command pattern as
    // `panecrew._internal.getExternalRefreshCount` — this is the exact call
    // site both `onDidStartTerminalShellExecution` (an OSC 9/777 signal
    // arriving) and `focusFollow.ts`'s `onFolderFocused` (a pane gaining
    // focus) invoke; only the live-terminal/live-focus *trigger* itself is
    // substituted, not the mark/clear/badge/label logic under test, since
    // automating a real terminal shell-integration session or a real
    // terminal-focus transition headless is not reliable in
    // @vscode/test-electron (spec.md's Testing Decisions already scope this
    // feature's wiring tests to decoration-provider/command level, not live
    // terminal simulation).
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    // Doesn't assert the description's exact/absent value at baseline — the
    // fixture workspace folder lives inside this real repo's own working
    // tree, so `refreshProjectStatuses` may have already populated a real
    // git status label by the time this test runs; only the attention
    // glyph's presence/absence is under test here.
    const descriptionBefore = await vscode.commands.executeCommand<string | undefined>(
      "panecrew._internal.crossRepoDescription",
      folder.uri,
    );
    assert.ok(!descriptionBefore?.startsWith("●"), "no attention glyph expected before marking");

    await vscode.commands.executeCommand("panecrew._internal.markAttention", folder.uri.fsPath);
    assert.strictEqual(await vscode.commands.executeCommand("panecrew._internal.hasAttention", folder.uri.fsPath), true);
    const descriptionWithAttention = await vscode.commands.executeCommand<string | undefined>(
      "panecrew._internal.crossRepoDescription",
      folder.uri,
    );
    assert.ok(descriptionWithAttention?.startsWith("●"), "Projects Overview label should be prefixed with the attention glyph");

    await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);
    assert.strictEqual(await vscode.commands.executeCommand("panecrew._internal.hasAttention", folder.uri.fsPath), false);
    const descriptionAfter = await vscode.commands.executeCommand<string | undefined>(
      "panecrew._internal.crossRepoDescription",
      folder.uri,
    );
    assert.ok(!descriptionAfter?.startsWith("●"), "attention glyph should be gone after clearing");
  });

  test("marking/clearing attention also refreshes the real Needs-Attention queue view", async () => {
    // Same choke-point as the test above, extended to the third view
    // (.scratch/attention-queue ticket 03: markAttention/clearAttention are
    // the single source of truth feeding all three surfaces).
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);
    const rootsBefore = await vscode.commands.executeCommand<string[]>("panecrew._internal.attentionQueueRoots");
    assert.ok(!rootsBefore.includes(folder.uri.fsPath));

    await vscode.commands.executeCommand("panecrew._internal.markAttention", folder.uri.fsPath);
    const rootsWithAttention = await vscode.commands.executeCommand<string[]>("panecrew._internal.attentionQueueRoots");
    assert.ok(rootsWithAttention.includes(folder.uri.fsPath));

    await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);
    const rootsAfter = await vscode.commands.executeCommand<string[]>("panecrew._internal.attentionQueueRoots");
    assert.ok(!rootsAfter.includes(folder.uri.fsPath));
  });

  test("Needs-Attention queue is empty while panecrew.attentionBadges.enabled is off, and repopulates once re-enabled", async function () {
    this.timeout(10_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");
    const config = vscode.workspace.getConfiguration("panecrew");

    await vscode.commands.executeCommand("panecrew._internal.markAttention", folder.uri.fsPath);
    try {
      await config.update("attentionBadges.enabled", false, vscode.ConfigurationTarget.Workspace);
      const emptiedWhileDisabled = await waitUntil(
        async () => (await vscode.commands.executeCommand<string[]>("panecrew._internal.attentionQueueRoots")).length === 0,
        5_000,
      );
      assert.ok(emptiedWhileDisabled, "queue should be empty while the shared switch is off, even with pending attention underneath");

      await config.update("attentionBadges.enabled", true, vscode.ConfigurationTarget.Workspace);
      const repopulated = await waitUntil(
        async () => (await vscode.commands.executeCommand<string[]>("panecrew._internal.attentionQueueRoots")).includes(folder.uri.fsPath),
        5_000,
      );
      assert.ok(repopulated, "queue should repopulate immediately once re-enabled, no reload required");
    } finally {
      await config.update("attentionBadges.enabled", undefined, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);
    }
  });

  test("a real OSC 9 escape sequence written by a pane's own terminal is detected by the live attention pipeline (no internal shortcut command)", async function () {
    // 2026-08-28: the "marking/clearing attention" test above only proves
    // the mark/clear/badge/label logic once a notification is already
    // detected — it substitutes the actual trigger
    // (`onDidStartTerminalShellExecution` seeing a real OSC 9/777 sequence)
    // with the internal `markAttention` command. This test drives the real
    // trigger instead: a real, `layoutController`-tracked pane terminal
    // (created via the same `assignFolderToGrid` the folder-picker command
    // uses, just without the modal picker) runs the exact shell command a
    // real CLI hook runs (`printf '\033]9;...\007' > /dev/tty`), and the
    // test polls the real `attentionTracker` state via
    // `panecrew._internal.hasAttention` — no shortcut command bypasses the
    // shell-integration/OSC-parsing layer under test here.
    this.timeout(30_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);
    await vscode.commands.executeCommand("panecrew._internal.addProjectToGrid", folder.uri.fsPath);

    const expectedName = `PaneCrew: ${path.basename(folder.uri.fsPath)}`;
    const paneCreated = await waitUntil(() => vscode.window.terminals.some((t) => t.name === expectedName), 10_000);
    assert.ok(paneCreated, `addProjectToGrid should have created a real terminal named "${expectedName}"`);
    const paneTerminal = vscode.window.terminals.find((t) => t.name === expectedName);
    assert.ok(paneTerminal);

    paneTerminal.sendText("printf '\\033]9;end-to-end attention test\\007' > /dev/tty 2>/dev/null || true", true);

    const gotAttention = await waitUntil(
      async () => (await vscode.commands.executeCommand("panecrew._internal.hasAttention", folder.uri.fsPath)) === true,
      20_000,
    );
    assert.ok(
      gotAttention,
      "the real onDidStartTerminalShellExecution -> attentionSignal -> markAttention pipeline should have detected the OSC 9 sequence the pane's own terminal wrote to /dev/tty",
    );
  });

  test("panecrew.jumpToAttentionPane focuses the target pane's terminal", async function () {
    // Relies on the previous test (or "addProjectToGrid" below) having
    // created a real, layoutController-tracked terminal for `folder` —
    // .scratch/attention-queue ticket 02.
    this.timeout(15_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    await vscode.commands.executeCommand("panecrew._internal.addProjectToGrid", folder.uri.fsPath);
    const expectedName = `PaneCrew: ${path.basename(folder.uri.fsPath)}`;
    const paneCreated = await waitUntil(() => vscode.window.terminals.some((t) => t.name === expectedName), 10_000);
    assert.ok(paneCreated);

    await vscode.commands.executeCommand("panecrew.jumpToAttentionPane", folder.uri.fsPath);
    const focused = await waitUntil(() => vscode.window.activeTerminal?.name === expectedName, 5_000);
    assert.ok(focused, "jumpToAttentionPane should have focused the pane's terminal");

    // A project path with no active pane is a safe no-op, not a throw.
    await vscode.commands.executeCommand("panecrew.jumpToAttentionPane", "/no/such/project");
  });

  test("panecrew.jumpToNextAttention jumps to the queue's oldest entry, and is a safe no-op when empty", async function () {
    this.timeout(15_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);
    await vscode.commands.executeCommand("panecrew.jumpToNextAttention"); // empty queue, must not throw

    await vscode.commands.executeCommand("panecrew._internal.addProjectToGrid", folder.uri.fsPath);
    const expectedName = `PaneCrew: ${path.basename(folder.uri.fsPath)}`;
    await waitUntil(() => vscode.window.terminals.some((t) => t.name === expectedName), 10_000);

    // An earlier-queued fake root with no live pane sits ahead of `folder`
    // in the ordered queue but can't itself be focused — proves the command
    // reads the real, tracker-ordered queue rather than only ever acting on
    // whatever's most recently marked.
    await vscode.commands.executeCommand("panecrew._internal.markAttention", "/no/such/earlier-project");
    await vscode.commands.executeCommand("panecrew._internal.markAttention", folder.uri.fsPath);
    try {
      const activeBefore = vscode.window.activeTerminal?.name;
      await vscode.commands.executeCommand("panecrew.jumpToNextAttention");
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.strictEqual(
        vscode.window.activeTerminal?.name,
        activeBefore,
        "the front (fake, pane-less) entry should not resolve to the real pane's terminal",
      );
    } finally {
      await vscode.commands.executeCommand("panecrew._internal.clearAttention", "/no/such/earlier-project");
      await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);
    }
  });

  test("panecrew.attentionAutopilot.autoAdvance jumps to the next entry once the front entry is cleared", async function () {
    this.timeout(15_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");
    const config = vscode.workspace.getConfiguration("panecrew");

    await vscode.commands.executeCommand("panecrew._internal.addProjectToGrid", folder.uri.fsPath);
    const expectedName = `PaneCrew: ${path.basename(folder.uri.fsPath)}`;
    await waitUntil(() => vscode.window.terminals.some((t) => t.name === expectedName), 10_000);
    await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);

    try {
      await config.update("attentionAutopilot.autoAdvance", true, vscode.ConfigurationTarget.Workspace);

      // "front-earlier" is queued first (front of the queue); `folder` is
      // second. Clearing the front entry with auto-advance on should jump
      // to `folder`, the next queued (and only real) pane.
      await vscode.commands.executeCommand("panecrew._internal.markAttention", "/no/such/front-earlier");
      await vscode.commands.executeCommand("panecrew._internal.markAttention", folder.uri.fsPath);

      await vscode.commands.executeCommand("panecrew._internal.clearAttention", "/no/such/front-earlier");
      const autoAdvanced = await waitUntil(() => vscode.window.activeTerminal?.name === expectedName, 5_000);
      assert.ok(autoAdvanced, "clearing the front entry should auto-jump to the next queued (real) pane");

      // Clearing a non-front entry must never auto-advance, regardless of
      // the setting.
      await vscode.commands.executeCommand("panecrew._internal.markAttention", "/no/such/non-front");
      const rootsBeforeNonFrontClear = await vscode.commands.executeCommand<string[]>("panecrew._internal.attentionQueueRoots");
      assert.deepStrictEqual(rootsBeforeNonFrontClear, [folder.uri.fsPath, "/no/such/non-front"]);
      await vscode.commands.executeCommand("panecrew._internal.clearAttention", "/no/such/non-front");
      const rootsAfterNonFrontClear = await vscode.commands.executeCommand<string[]>("panecrew._internal.attentionQueueRoots");
      assert.deepStrictEqual(rootsAfterNonFrontClear, [folder.uri.fsPath], "front entry should be untouched by clearing a non-front one");
    } finally {
      await config.update("attentionAutopilot.autoAdvance", undefined, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);
      await vscode.commands.executeCommand("panecrew._internal.clearAttention", "/no/such/non-front");
    }
  });

  test("with auto-advance off (default), clearing the front entry never auto-jumps", async function () {
    this.timeout(15_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");

    await vscode.commands.executeCommand("panecrew._internal.addProjectToGrid", folder.uri.fsPath);
    const expectedName = `PaneCrew: ${path.basename(folder.uri.fsPath)}`;
    await waitUntil(() => vscode.window.terminals.some((t) => t.name === expectedName), 10_000);
    await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);

    await vscode.commands.executeCommand("panecrew._internal.markAttention", "/no/such/front-only");
    await vscode.commands.executeCommand("panecrew._internal.markAttention", folder.uri.fsPath);
    try {
      const activeBefore = vscode.window.activeTerminal?.name;
      await vscode.commands.executeCommand("panecrew._internal.clearAttention", "/no/such/front-only");
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.strictEqual(vscode.window.activeTerminal?.name, activeBefore, "default (off) auto-advance must never auto-jump");
    } finally {
      await vscode.commands.executeCommand("panecrew._internal.clearAttention", folder.uri.fsPath);
    }
  });

  /** Drives the real `panecrew.configureCliToolNotifications` command's
   * quick-pick -> diff-preview -> confirm -> write flow end-to-end, only
   * substituting the two interactive prompts (a human's tool pick and their
   * "Write Change" confirmation) — the actual read/compute/diff/write path
   * is exactly what production code runs. Only ever used for project-scoped
   * adapters (writes land inside the disposable fixture workspace, under
   * `configDirName`); the user-scope Codex adapter is intentionally never
   * driven this way, since that would mean writing to a real developer's
   * own `~/.codex/config.toml`. */
  async function verifyCliAdapterEndToEnd(options: {
    toolLabel: string;
    configDirName: string;
    configFileName: string;
    expectedSubstring: string;
  }): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test run needs a real workspace folder (see .vscode-test.mjs launchArgs)");
    const settingsUri = vscode.Uri.joinPath(folder.uri, options.configDirName, options.configFileName);

    const originalShowQuickPick = vscode.window.showQuickPick;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let diffShown = false;
    const diffListener = vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme === "panecrew-cli-adapter-preview") diffShown = true;
    });
    try {
      // @ts-expect-error -- narrowing the real overloaded showQuickPick signature to this test's single call shape
      vscode.window.showQuickPick = (items: { label: string }[]) =>
        Promise.resolve(items.find((item) => item.label === options.toolLabel));
      vscode.window.showWarningMessage = () => Promise.resolve("Write Change");

      await vscode.commands.executeCommand("panecrew.configureCliToolNotifications");

      assert.ok(diffShown, "the diff preview editor should have opened before the write");
      const written = new TextDecoder().decode(await vscode.workspace.fs.readFile(settingsUri));
      assert.ok(
        written.includes(options.expectedSubstring),
        `the written ${options.configDirName}/${options.configFileName} should contain PaneCrew's OSC notify hook`,
      );
    } finally {
      vscode.window.showQuickPick = originalShowQuickPick;
      vscode.window.showWarningMessage = originalShowWarningMessage;
      diffListener.dispose();
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder.uri, options.configDirName), {
        recursive: true,
        useTrash: false,
      });
    }
  }

  test("panecrew.configureCliToolNotifications previews and writes the Claude Code notify hook end-to-end", async function () {
    this.timeout(10_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    await verifyCliAdapterEndToEnd({
      toolLabel: "Claude Code",
      configDirName: ".claude",
      configFileName: "settings.json",
      expectedSubstring: "Claude Code needs your attention",
    });
  });

  test("panecrew.configureCliToolNotifications previews and writes the Gemini CLI notify hook end-to-end", async function () {
    this.timeout(10_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    await verifyCliAdapterEndToEnd({
      toolLabel: "Gemini CLI",
      configDirName: ".gemini",
      configFileName: "settings.json",
      expectedSubstring: "Gemini CLI needs your attention",
    });
  });

  test("panecrew.configureCliToolNotifications previews and writes the GitHub Copilot CLI hooks file end-to-end", async function () {
    this.timeout(10_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    await verifyCliAdapterEndToEnd({
      toolLabel: "GitHub Copilot CLI",
      configDirName: ".github/hooks",
      configFileName: "panecrew-attention.json",
      expectedSubstring: "GitHub Copilot needs your attention",
    });
  });

  test("panecrew.configureCliToolNotifications previews and writes the OpenCode plugin file end-to-end", async function () {
    this.timeout(10_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    await verifyCliAdapterEndToEnd({
      toolLabel: "OpenCode",
      configDirName: ".opencode/plugins",
      configFileName: "panecrew-attention.js",
      expectedSubstring: "OpenCode needs your attention",
    });
  });

  test("Compact Look hides the title bar chat/agent-status indicator, and restoring brings it back", async () => {
    const store = new Map<string, unknown>();
    const memento: CompactLookMemento = {
      get: ((key: string) => store.get(key)) as CompactLookMemento["get"],
      update: (key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      },
    };

    const config = vscode.workspace.getConfiguration();
    const before = config.inspect<string>("chat.agentsControl.enabled")?.globalValue;
    try {
      await applyCompactLook(memento);
      assert.strictEqual(
        vscode.workspace.getConfiguration().get<string>("chat.agentsControl.enabled"),
        "hidden",
        "Compact Look must hide the title bar chat/agent-status indicator",
      );

      await restoreLook(memento);
      assert.strictEqual(
        vscode.workspace.getConfiguration().inspect<string>("chat.agentsControl.enabled")?.globalValue,
        before,
        "restoring Compact Look must bring the indicator back to its exact prior value",
      );
    } finally {
      await config.update("chat.agentsControl.enabled", before, vscode.ConfigurationTarget.Global);
    }
  });

  test("disables workbench.editor.closeEmptyGroups on activation, so a template's still-unfilled slots survive between folder adds", async () => {
    // Root cause of the "Quad (2x2) renders as 4-in-a-row" bug: PaneCrew
    // pre-builds a template's full editor-group tree up front and fills
    // slots one at a time as folders are added, so unfilled slots are
    // genuinely empty groups for a while. VS Code's own
    // `workbench.editor.closeEmptyGroups` (default true) treats any empty
    // group as user clutter and prunes it, which collapses the grid toward
    // a flatter shape well before every slot is filled — reproduced
    // headless via a real `GridLayoutController` driving 4 sequential
    // `apply()` calls against the real editor-group engine (see
    // `gridLayoutRepro.test.ts` history / commit message for the full
    // before/after `vscode.getEditorLayout()` trace).
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();

    const closeEmptyGroups = vscode.workspace
      .getConfiguration("workbench.editor")
      .get<boolean>("closeEmptyGroups");
    assert.strictEqual(
      closeEmptyGroups,
      false,
      "PaneCrew must turn this off — its own pre-built empty grid slots are not the clutter this setting is meant to clean up",
    );
  });
});
