import { describe, expect, it } from "vitest";
import { assignProjectToSlot, INITIAL_GRID_STATE } from "../grid/gridState";
import { clearSession, loadSession, saveSession } from "./persistence";
import { createFakeMemento as fakeMemento } from "../testMemento";

describe("session persistence", () => {
  it("returns null when nothing was ever saved", () => {
    expect(loadSession(fakeMemento())).toBeNull();
  });

  it("round-trips an empty grid", async () => {
    const memento = fakeMemento();
    await saveSession(memento, INITIAL_GRID_STATE);
    const restored = loadSession(memento);
    expect(restored).toEqual({
      template: "quad",
      slots: [null, null, null, null],
      splitRatios: [],
      closedProjectPaths: [],
    });
  });

  it("round-trips a grid with an occupied pane", async () => {
    const memento = fakeMemento();
    const grid = assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-a", "tab-a");
    await saveSession(memento, grid);
    const restored = loadSession(memento);
    expect(restored?.template).toBe("quad");
    expect(restored?.slots[0]).toMatchObject({ project_path: "/repo/a" });
  });

  it("clears a saved session", async () => {
    const memento = fakeMemento();
    await saveSession(memento, INITIAL_GRID_STATE);
    await clearSession(memento);
    expect(loadSession(memento)).toBeNull();
  });
});
