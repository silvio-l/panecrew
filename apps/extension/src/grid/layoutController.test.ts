import { describe, expect, it } from "vitest";
import { assignProjectToSlot, GRID_TEMPLATES, INITIAL_GRID_STATE, switchTemplate } from "./gridState";
import {
  computeApplyPlan,
  countLeafGroups,
  editorGroupLayoutForTemplate,
  GridLayoutController,
  type VscodeLike,
} from "./layoutController";

interface PreexistingTerminal {
  name: string;
  /** `creationOptions.cwd` — set this to simulate a terminal created earlier
   * in the very same session (e.g. by this controller itself). Confirmed via
   * live instrumentation (2026-08-28) to come back empty for a terminal VS
   * Code revives from a persisted session across a full Extension
   * Development Host restart — leave unset for that case, use
   * `shellIntegrationCwd` instead. */
  cwd?: string;
  /** `shellIntegration.cwd` — the source that DOES carry a revived
   * terminal's cwd (see `cwd`'s comment above and `terminalCwd` in
   * `layoutController.ts`). */
  shellIntegrationCwd?: string;
}

/** A fake `VscodeLike` that hands out incrementing fake terminals, just
 * enough for `GridLayoutController.apply` to run without a real VS Code
 * host — this file stays vscode-import-free per this module's own
 * pure/impure split (see the header comment in `layoutController.ts`).
 * `preexisting` seeds `window.terminals` as if VS Code had already restored
 * those terminals before the controller's own maps exist — simulates the
 * "Developer: Reload Window" scenario `ensureTerminal`'s adoption logic must
 * handle. */
function fakeVscode(preexisting: readonly (string | PreexistingTerminal)[] = []) {
  const terminals = preexisting.map((entry) => {
    const { name, cwd, shellIntegrationCwd } = typeof entry === "string" ? { name: entry, cwd: undefined, shellIntegrationCwd: undefined } : entry;
    return {
      name,
      creationOptions: cwd === undefined ? undefined : { cwd },
      shellIntegration: shellIntegrationCwd === undefined ? undefined : { cwd: { fsPath: shellIntegrationCwd } },
      show: () => { /* no-op fake terminal */ },
    };
  });
  let createdCount = 0;
  const vscode: VscodeLike = {
    commands: { executeCommand: () => Promise.resolve() },
    window: {
      createTerminal: (options) => {
        createdCount++;
        const terminal = {
          name: options.name,
          creationOptions: { cwd: options.cwd },
          shellIntegration: undefined,
          show: () => { /* no-op fake terminal */ },
        };
        terminals.push(terminal);
        return terminal;
      },
      terminals,
    },
  };
  return { vscode, terminals, createdCount: () => createdCount };
}

describe("editorGroupLayoutForTemplate", () => {
  it("produces exactly as many leaf groups as each template's slotCount", () => {
    for (const template of GRID_TEMPLATES) {
      const layout = editorGroupLayoutForTemplate(template.id);
      expect(countLeafGroups(layout)).toBe(template.slotCount);
    }
  });

  it("lays out a single pane as one horizontal group", () => {
    expect(editorGroupLayoutForTemplate("single")).toEqual({
      orientation: 0,
      groups: [{}],
    });
  });

  it("lays out split as two side-by-side groups", () => {
    expect(editorGroupLayoutForTemplate("split")).toEqual({
      orientation: 0,
      groups: [{}, {}],
    });
  });

  it("lays out quad as a vertical split of two horizontal pairs", () => {
    expect(editorGroupLayoutForTemplate("quad")).toEqual({
      orientation: 1,
      groups: [{ groups: [{}, {}] }, { groups: [{}, {}] }],
    });
  });

  it("lays out two-over-one as a split top row over a single full-width group", () => {
    expect(editorGroupLayoutForTemplate("two-over-one")).toEqual({
      orientation: 1,
      groups: [{ groups: [{}, {}] }, {}],
    });
  });

  it("lays out one-over-two as a single full-width group over a split row", () => {
    expect(editorGroupLayoutForTemplate("one-over-two")).toEqual({
      orientation: 1,
      groups: [{}, { groups: [{}, {}] }],
    });
  });
});

describe("computeApplyPlan", () => {
  it("produces no assignments for an empty grid", () => {
    const plan = computeApplyPlan(INITIAL_GRID_STATE);
    expect(plan.assignments).toEqual([]);
    expect(plan.layout).toEqual(editorGroupLayoutForTemplate(INITIAL_GRID_STATE.template));
  });

  it("assigns each occupied slot a 1-based view column matching its slot index", () => {
    const grid = assignProjectToSlot(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"),
      2,
      "/repo/b",
      "pane-b",
      "tab-b",
    );
    const plan = computeApplyPlan(grid);
    expect(plan.assignments).toEqual([
      { slotIndex: 0, pane: grid.slots[0], viewColumn: 1 },
      { slotIndex: 2, pane: grid.slots[2], viewColumn: 3 },
    ]);
  });

  it("keeps assignments in ascending slot order for a shrunk template", () => {
    const grid = switchTemplate(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"),
      "single",
    );
    const plan = computeApplyPlan(grid);
    expect(plan.assignments.map((a) => a.slotIndex)).toEqual([0]);
  });
});

describe("GridLayoutController.paneForViewColumn", () => {
  // Regression test for the focus-follow bug (2026-08-27): the explorer
  // failed to switch when a pane's editor group hosted a terminal PaneCrew
  // itself didn't create (e.g. the user or an agent opening a second
  // terminal, such as a CLI coding agent, inside that group) — a lookup
  // keyed on `paneForTerminal`'s exact terminal identity silently no-oped
  // for it. `paneForViewColumn` resolves by editor group instead, so it
  // must return the right pane regardless of which terminal is focused.
  it("resolves a pane by its assigned view column after apply()", async () => {
    const controller = new GridLayoutController(fakeVscode().vscode);
    const grid = assignProjectToSlot(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"),
      2,
      "/repo/b",
      "pane-b",
      "tab-b",
    );
    await controller.apply(grid);

    expect(controller.paneForViewColumn(1)).toEqual(grid.slots[0]);
    expect(controller.paneForViewColumn(3)).toEqual(grid.slots[2]);
  });

  it("returns null for a view column with no assigned pane", async () => {
    const controller = new GridLayoutController(fakeVscode().vscode);
    await controller.apply(assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"));

    expect(controller.paneForViewColumn(2)).toBeNull();
  });

  it("forgets a pane's view column when the pane is closed", async () => {
    const controller = new GridLayoutController(fakeVscode().vscode);
    const grid = assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a");
    await controller.apply(grid);

    controller.forgetPane("pane-a");

    expect(controller.paneForViewColumn(1)).toBeNull();
  });
});

describe("GridLayoutController terminal adoption", () => {
  // Regression test for the duplicate-terminal bug (2026-08-27): after a
  // "Developer: Reload Window" (or any extension-host restart whose saved
  // session didn't survive — unreliable for an unsaved multi-root
  // workspace's workspaceState), a fresh GridLayoutController's maps start
  // empty even though VS Code kept the pane's terminal alive across the
  // reload. Without adoption, apply() spawned a second terminal for the
  // same pane every single time instead of reusing the surviving one.
  it("adopts an existing terminal with the expected name instead of creating a duplicate", async () => {
    const fake = fakeVscode(["PaneCrew: a"]);
    const controller = new GridLayoutController(fake.vscode);

    await controller.apply(assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"));

    expect(fake.createdCount()).toBe(0);
    expect(fake.terminals).toHaveLength(1);
  });

  it("still creates a terminal when no matching one already exists", async () => {
    const fake = fakeVscode();
    const controller = new GridLayoutController(fake.vscode);

    await controller.apply(assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"));

    expect(fake.createdCount()).toBe(1);
  });

  // Original regression test for the duplicate-terminal bug reported
  // 2026-08-28: VS Code revives a terminal from a persisted session with a
  // generic, shell-derived name ("zsh") instead of the "PaneCrew: <project>"
  // name this controller originally set — matching by name alone (the
  // original 2026-08-27 fix) never found it and created a second terminal.
  // This exact scenario (a revived terminal reporting its cwd via
  // `creationOptions`) turned out not to match live VS Code behavior (see
  // the next test) but is kept as a real, if currently synthetic, case:
  // whichever future VS Code version DOES replay `cwd` into
  // `creationOptions` on revival must still be handled correctly.
  it("adopts a live terminal by creationOptions.cwd even when its name reverted to a generic shell name", async () => {
    const fake = fakeVscode([{ name: "zsh", cwd: "/repo/a" }]);
    const controller = new GridLayoutController(fake.vscode);

    await controller.apply(assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"));

    expect(fake.createdCount()).toBe(0);
    expect(fake.terminals).toHaveLength(1);
  });

  it("does not adopt a live terminal whose creationOptions.cwd belongs to a different project", async () => {
    const fake = fakeVscode([{ name: "zsh", cwd: "/repo/other" }]);
    const controller = new GridLayoutController(fake.vscode);

    await controller.apply(assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"));

    expect(fake.createdCount()).toBe(1);
    expect(fake.terminals).toHaveLength(2);
  });

  // Regression test for what live instrumentation in the real Extension
  // Development Host actually showed (2026-08-28): a terminal VS Code
  // revives from a persisted session across a full extension-host restart
  // reports NEITHER its original name NOR a `creationOptions.cwd` — every
  // revived terminal came back as bare `{ name: "zsh" }`. The only source
  // that DOES carry its real cwd is shell integration
  // (`terminal.shellIntegration.cwd`), which for an already-running revived
  // terminal has normally finished its handshake by the time `apply()` runs.
  it("adopts a revived terminal by shellIntegration.cwd when creationOptions carries nothing at all", async () => {
    const fake = fakeVscode([{ name: "zsh", shellIntegrationCwd: "/repo/a" }]);
    const controller = new GridLayoutController(fake.vscode);

    await controller.apply(assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"));

    expect(fake.createdCount()).toBe(0);
    expect(fake.terminals).toHaveLength(1);
  });

  it("does not adopt a revived terminal whose shellIntegration.cwd belongs to a different project", async () => {
    const fake = fakeVscode([{ name: "zsh", shellIntegrationCwd: "/repo/other" }]);
    const controller = new GridLayoutController(fake.vscode);

    await controller.apply(assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a"));

    expect(fake.createdCount()).toBe(1);
    expect(fake.terminals).toHaveLength(2);
  });
});
