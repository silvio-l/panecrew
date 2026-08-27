import { describe, expect, it } from "vitest";
import { assignProjectToSlot, GRID_TEMPLATES, INITIAL_GRID_STATE, switchTemplate } from "./gridState";
import { computeApplyPlan, countLeafGroups, editorGroupLayoutForTemplate } from "./layoutController";

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
