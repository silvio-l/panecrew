import { describe, expect, it } from "vitest";
import { assignProjectToSlot, GRID_TEMPLATES, INITIAL_GRID_STATE, switchTemplate } from "./gridState";
import {
  computeApplyPlan,
  countLeafGroups,
  editorGroupLayoutForTemplate,
  GridLayoutController,
  type VscodeLike,
} from "./layoutController";

/** A fake `VscodeLike` that hands out incrementing fake terminals, just
 * enough for `GridLayoutController.apply` to run without a real VS Code
 * host — this file stays vscode-import-free per this module's own
 * pure/impure split (see the header comment in `layoutController.ts`).
 * `preexistingTerminalNames` seeds `window.terminals` as if VS Code had
 * already restored those terminals before the controller's own maps exist —
 * simulates the "Developer: Reload Window" scenario `ensureTerminal`'s
 * adoption logic must handle. */
function fakeVscode(preexistingTerminalNames: readonly string[] = []) {
  const terminals = preexistingTerminalNames.map((name) => ({ name, show: () => { /* no-op fake terminal */ } }));
  let createdCount = 0;
  const vscode: VscodeLike = {
    commands: { executeCommand: () => Promise.resolve() },
    window: {
      createTerminal: (options) => {
        createdCount++;
        const terminal = { name: options.name, show: () => { /* no-op fake terminal */ } };
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
});
