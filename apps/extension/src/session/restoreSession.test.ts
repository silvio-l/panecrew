import { describe, expect, it } from "vitest";
import type { RestoredSession } from "./persistence";
import { restoreGridState } from "./restoreSession";

function makeIdSequence(): () => string {
  let n = 0;
  return () => `id-${n++}`;
}

describe("restoreGridState", () => {
  it("backfills an open folder when no session was ever saved (extension host restarted before persisting)", () => {
    const result = restoreGridState(null, ["/repo/a"], makeIdSequence());
    expect(result.gridState.slots[0]).toMatchObject({ projectPath: "/repo/a" });
  });

  it("keeps a restored, still-open pane assigned without duplicating it", () => {
    const restored: RestoredSession = {
      template: "quad",
      splitRatios: [],
      closedProjectPaths: [],
      slots: [
        {
          project_path: "/repo/a",
          terminal_tabs: [],
          active_tab: { kind: "terminal", id: "t" },
        },
        null,
        null,
        null,
      ],
    };
    const result = restoreGridState(restored, ["/repo/a"], makeIdSequence());
    const occupied = result.gridState.slots.filter((slot) => slot?.projectPath === "/repo/a");
    expect(occupied).toHaveLength(1);
  });

  it("does NOT resurrect a pane the user deliberately closed while its folder stayed open (regression: reload used to reopen every project in Projektvorschau)", () => {
    const restored: RestoredSession = {
      template: "quad",
      splitRatios: [],
      closedProjectPaths: ["/repo/closed"],
      slots: [null, null, null, null],
    };
    const result = restoreGridState(restored, ["/repo/closed"], makeIdSequence());
    expect(result.gridState.slots.every((slot) => slot === null)).toBe(true);
    expect(result.closedProjectPaths.has("/repo/closed")).toBe(true);
  });

  it("still backfills a genuinely new folder (added outside PaneCrew) even when a valid session exists", () => {
    const restored: RestoredSession = {
      template: "quad",
      splitRatios: [],
      closedProjectPaths: [],
      slots: [
        {
          project_path: "/repo/a",
          terminal_tabs: [],
          active_tab: { kind: "terminal", id: "t" },
        },
        null,
        null,
        null,
      ],
    };
    const result = restoreGridState(restored, ["/repo/a", "/repo/new"], makeIdSequence());
    expect(result.gridState.slots.some((slot) => slot?.projectPath === "/repo/new")).toBe(true);
  });

  it("drops a path from closedProjectPaths once it's assigned to a slot again", () => {
    const restored: RestoredSession = {
      template: "quad",
      splitRatios: [],
      closedProjectPaths: ["/repo/a"],
      slots: [
        {
          project_path: "/repo/a",
          terminal_tabs: [],
          active_tab: { kind: "terminal", id: "t" },
        },
        null,
        null,
        null,
      ],
    };
    const result = restoreGridState(restored, ["/repo/a"], makeIdSequence());
    expect(result.closedProjectPaths.has("/repo/a")).toBe(false);
  });
});
