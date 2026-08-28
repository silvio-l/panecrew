import { describe, expect, it } from "vitest";
import { assignProjectToSlot, INITIAL_GRID_STATE } from "./gridState";
import {
  deletePreset,
  gridStateFromPreset,
  loadPresets,
  presetProjectPaths,
  presetStartupCommands,
  savePreset,
} from "./presets";
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
      {
        name: "my-preset",
        template: "quad",
        slots: [null, { projectPath: "/repo/a", startupCommand: null }, null, null],
      },
    ]);
  });

  it("saves a preset with a per-pane startup command", async () => {
    const memento = fakeMemento();
    const grid = assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a");
    await savePreset(memento, "p", grid, new Map([["pane-a", "claude"]]));

    expect(loadPresets(memento)[0]?.slots[0]).toEqual({ projectPath: "/repo/a", startupCommand: "claude" });
  });

  it("migrates a pre-Auto-Start preset whose slots were bare project-path strings", () => {
    const memento = fakeMemento();
    // Simulates on-disk state from before the `PresetSlot` shape existed.
    void memento.update("panecrew.presets", [{ name: "old", template: "split", slots: ["/repo/a", null] }]);

    expect(loadPresets(memento)).toEqual([
      { name: "old", template: "split", slots: [{ projectPath: "/repo/a", startupCommand: null }, null] },
    ]);
  });

  it("overwrites a preset with the same name instead of duplicating it", async () => {
    const memento = fakeMemento();
    await savePreset(memento, "p", INITIAL_GRID_STATE);
    const grid = assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a");
    await savePreset(memento, "p", grid);

    expect(loadPresets(memento)).toHaveLength(1);
    expect(loadPresets(memento)[0]?.slots[0]).toEqual({ projectPath: "/repo/a", startupCommand: null });
  });

  it("deletes a preset by name", async () => {
    const memento = fakeMemento();
    await savePreset(memento, "p", INITIAL_GRID_STATE);
    await deletePreset(memento, "p");
    expect(loadPresets(memento)).toEqual([]);
  });

  it("rebuilds a grid state from a preset with fresh ids", () => {
    const preset = {
      name: "p",
      template: "split" as const,
      slots: [{ projectPath: "/repo/a", startupCommand: null }, null],
    };
    let counter = 0;
    const grid = gridStateFromPreset(preset, () => `id-${counter++}`);

    expect(grid.template).toBe("split");
    expect(grid.slots).toHaveLength(2);
    expect(grid.slots[0]).toMatchObject({ projectPath: "/repo/a" });
    expect(grid.slots[1]).toBeNull();
  });

  it("extracts project paths from a preset, skipping empty slots", () => {
    const preset = {
      name: "p",
      template: "quad" as const,
      slots: [
        { projectPath: "/a", startupCommand: null },
        null,
        { projectPath: "/b", startupCommand: null },
        null,
      ],
    };
    expect(presetProjectPaths(preset)).toEqual(["/a", "/b"]);
  });

  it("zips a preset's startup commands to the fresh grid's pane ids, skipping slots without one", () => {
    const preset = {
      name: "p",
      template: "split" as const,
      slots: [
        { projectPath: "/repo/a", startupCommand: "claude" },
        { projectPath: "/repo/b", startupCommand: null },
      ],
    };
    let counter = 0;
    const grid = gridStateFromPreset(preset, () => `id-${counter++}`);

    const commands = presetStartupCommands(preset, grid);

    expect(commands.size).toBe(1);
    expect(commands.get((grid.slots[0] as { paneId: string }).paneId)).toBe("claude");
  });
});
