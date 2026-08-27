import { describe, expect, it } from "vitest";
import { assignProjectToSlot, INITIAL_GRID_STATE } from "./gridState";
import { deletePreset, gridStateFromPreset, loadPresets, presetProjectPaths, savePreset } from "./presets";
import { createFakeMemento as fakeMemento } from "../testMemento";

describe("presets", () => {
  it("starts empty", () => {
    expect(loadPresets(fakeMemento())).toEqual([]);
  });

  it("saves and reloads a preset built from a grid", async () => {
    const memento = fakeMemento();
    const grid = assignProjectToSlot(INITIAL_GRID_STATE, 1, "/repo/a", "pane-a", "tab-a");
    await savePreset(memento, "my-preset", grid);

    const presets = loadPresets(memento);
    expect(presets).toEqual([
      { name: "my-preset", template: "quad", slots: [null, "/repo/a", null, null] },
    ]);
  });

  it("overwrites a preset with the same name instead of duplicating it", async () => {
    const memento = fakeMemento();
    await savePreset(memento, "p", INITIAL_GRID_STATE);
    const grid = assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a");
    await savePreset(memento, "p", grid);

    expect(loadPresets(memento)).toHaveLength(1);
    expect(loadPresets(memento)[0]?.slots[0]).toBe("/repo/a");
  });

  it("deletes a preset by name", async () => {
    const memento = fakeMemento();
    await savePreset(memento, "p", INITIAL_GRID_STATE);
    await deletePreset(memento, "p");
    expect(loadPresets(memento)).toEqual([]);
  });

  it("rebuilds a grid state from a preset with fresh ids", () => {
    const preset = { name: "p", template: "split" as const, slots: ["/repo/a", null] };
    let counter = 0;
    const grid = gridStateFromPreset(preset, () => `id-${counter++}`);

    expect(grid.template).toBe("split");
    expect(grid.slots).toHaveLength(2);
    expect(grid.slots[0]).toMatchObject({ projectPath: "/repo/a" });
    expect(grid.slots[1]).toBeNull();
  });

  it("extracts project paths from a preset, skipping empty slots", () => {
    const preset = { name: "p", template: "quad" as const, slots: ["/a", null, "/b", null] };
    expect(presetProjectPaths(preset)).toEqual(["/a", "/b"]);
  });
});
