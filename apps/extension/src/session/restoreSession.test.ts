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

  // Regression test for the false "attention notifications won't fire"
  // warning (reported 2026-09-07): the warning fired for a brand-new,
  // never-before-tracked pane on a fresh folder open, because
  // `GridLayoutController.ensureTerminal`'s cwd-based adoption match cannot
  // tell "a live terminal PaneCrew itself created before" apart from "some
  // unrelated terminal that just happens to share this cwd" (e.g. one VS
  // Code's own persistence revived for a folder that was simply opened in
  // plain VS Code before ever being added to a PaneCrew grid).
  // `extension.ts`'s `logAdoptedPanes` fixes this by only warning for panes
  // in `restoredPaneIds` -- this asserts the set `restoreGridState` produces
  // actually excludes a backfilled (never-before-persisted) pane, which is
  // the exact case the bug report hit.
  it("does not mark a backfilled (never-before-persisted) pane as restored", () => {
    const result = restoreGridState(null, ["/repo/brand-new"], makeIdSequence());
    expect(result.gridState.slots.some((slot) => slot?.projectPath === "/repo/brand-new")).toBe(true);
    expect(result.restoredPaneIds.size).toBe(0);
  });

  it("marks only the panes assigned from a genuinely persisted session as restored", () => {
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
    const restoredPane = result.gridState.slots.find((slot) => slot?.projectPath === "/repo/a");
    const backfilledPane = result.gridState.slots.find((slot) => slot?.projectPath === "/repo/new");
    if (!restoredPane || !backfilledPane) throw new Error("expected both panes to be assigned");
    expect(result.restoredPaneIds.has(restoredPane.paneId)).toBe(true);
    expect(result.restoredPaneIds.has(backfilledPane.paneId)).toBe(false);
  });

  // Regression test for the "grid always starts 2x2, ignoring my configured
  // default" bug (reported 2026-09-07): `extension.ts` used to apply
  // `panecrew.grid.defaultColumns`/`defaultRows` via a `switchTemplate` call
  // BEFORE calling this function, but that assignment was silently
  // discarded because this function always started from a fresh
  // `INITIAL_GRID_STATE` (hardcoded "quad") regardless of what the caller
  // had already computed. Concretely: a user with
  // `panecrew.grid.defaultRows: 1` (meant to default to "split", a 2-column
  // 1-row grid) got "quad" (2x2) every time session restore came back null
  // -- indistinguishable, from the user's side, from "my last session just
  // didn't restore".
  it("falls back to the caller-provided default template when no session was ever saved", () => {
    const result = restoreGridState(null, ["/repo/a"], makeIdSequence(), "split");
    expect(result.gridState.template).toBe("split");
  });

  it("still prefers the restored session's template over the caller-provided default", () => {
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
    const result = restoreGridState(restored, ["/repo/a"], makeIdSequence(), "split");
    expect(result.gridState.template).toBe("quad");
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
