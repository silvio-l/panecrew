import { describe, expect, it } from "vitest";
import {
  INITIAL_GRID_STATE,
  assignProjectToSlot,
  openTerminalTab,
  type GridState,
  type Pane,
} from "./gridState";
import { moveAcrossWindows } from "./crossWindowDrag";

function onePane(projectPath = "/repo/a", paneId = "pane-0", tabId = "tab-0"): GridState {
  return assignProjectToSlot(INITIAL_GRID_STATE, 0, projectPath, paneId, tabId);
}

function onePaneTwoTabs(): GridState {
  return openTerminalTab(onePane(), "pane-0", "tab-0b");
}

describe("moveAcrossWindows", () => {
  describe("pane payload", () => {
    it("swaps a pane with an occupied target slot in the other window", () => {
      const source = assignProjectToSlot(onePane(), 1, "/repo/other", "pane-1", "tab-1");
      const target = assignProjectToSlot(INITIAL_GRID_STATE, 2, "/repo/b", "pane-2", "tab-2");

      const result = moveAcrossWindows(
        source,
        target,
        { kind: "pane", paneId: "pane-0" },
        2,
      );

      expect((result.source.slots[0] as Pane).paneId).toBe("pane-2");
      expect((result.target.slots[2] as Pane).paneId).toBe("pane-0");
      // Identity preserved on both sides — the panes cross windows as the
      // same objects (their PTYs/tabs must not appear rebuilt).
      expect(result.source.slots[0]).toBe(target.slots[2]);
      expect(result.target.slots[2]).toBe(source.slots[0]);
      // Untouched slots stay referentially identical.
      expect(result.source.slots[1]).toBe(source.slots[1]);
    });

    it("focuses the arriving pane in each window after a swap", () => {
      const source = onePane();
      const target = assignProjectToSlot(INITIAL_GRID_STATE, 2, "/repo/b", "pane-2", "tab-2");

      const result = moveAcrossWindows(
        source,
        target,
        { kind: "pane", paneId: "pane-0" },
        2,
      );

      expect(result.source.focusedPaneId).toBe("pane-2");
      expect(result.target.focusedPaneId).toBe("pane-0");
    });

    it("moves a pane onto an empty target slot, emptying the source slot", () => {
      const source = onePane();
      const target = INITIAL_GRID_STATE;

      const result = moveAcrossWindows(
        source,
        target,
        { kind: "pane", paneId: "pane-0" },
        1,
      );

      expect(result.source.slots[0]).toBeNull();
      expect(result.target.slots[1]).toBe(source.slots[0]);
      expect(result.target.focusedPaneId).toBe("pane-0");
    });

    it("falls the source window's focus back to a remaining pane once the moved one vanished", () => {
      const source = assignProjectToSlot(onePane(), 1, "/repo/b", "pane-1", "tab-1");
      // pane-1 is the freshly focused one after the second assignment.
      expect(source.focusedPaneId).toBe("pane-1");
      const withFocusOnMoved = { ...source, focusedPaneId: "pane-0" };

      const result = moveAcrossWindows(
        withFocusOnMoved,
        INITIAL_GRID_STATE,
        { kind: "pane", paneId: "pane-0" },
        0,
      );

      expect(result.source.focusedPaneId).toBe("pane-1");
    });

    it("is a no-op when the source pane is unknown or the target index is out of range", () => {
      const source = onePane();
      const target = INITIAL_GRID_STATE;
      const unknownPane = moveAcrossWindows(
        source,
        target,
        { kind: "pane", paneId: "does-not-exist" },
        0,
      );
      expect(unknownPane.source).toBe(source);
      expect(unknownPane.target).toBe(target);

      const badIndex = moveAcrossWindows(
        source,
        target,
        { kind: "pane", paneId: "pane-0" },
        99,
      );
      expect(badIndex.source).toBe(source);
      expect(badIndex.target).toBe(target);
    });
  });

  describe("tab payload", () => {
    it("inserts the tab into a same-project target pane and activates it", () => {
      const source = onePaneTwoTabs();
      const target = assignProjectToSlot(INITIAL_GRID_STATE, 2, "/repo/a", "pane-2", "tab-2");

      const result = moveAcrossWindows(
        source,
        target,
        { kind: "tab", paneId: "pane-0", tabId: "tab-0b", newPaneId: "unused" },
        2,
      );

      const targetPane = result.target.slots[2] as Pane;
      expect(targetPane.terminalTabs.map((tab) => tab.tabId)).toEqual([
        "tab-2",
        "tab-0b",
      ]);
      expect(targetPane.activeTerminalTabId).toBe("tab-0b");
      expect(result.target.focusedPaneId).toBe("pane-2");

      const sourcePane = result.source.slots[0] as Pane;
      expect(sourcePane.terminalTabs.map((tab) => tab.tabId)).toEqual(["tab-0"]);
    });

    it("empties the source slot when its last tab moves out", () => {
      const source = onePane();
      const target = assignProjectToSlot(INITIAL_GRID_STATE, 1, "/repo/a", "pane-1", "tab-1");

      const result = moveAcrossWindows(
        source,
        target,
        { kind: "tab", paneId: "pane-0", tabId: "tab-0", newPaneId: "unused" },
        1,
      );

      expect(result.source.slots[0]).toBeNull();
    });

    it("creates a new pane on an empty target slot, carrying the source project", () => {
      const source = onePaneTwoTabs();

      const result = moveAcrossWindows(
        source,
        INITIAL_GRID_STATE,
        { kind: "tab", paneId: "pane-0", tabId: "tab-0b", newPaneId: "pane-new" },
        0,
      );

      const newPane = result.target.slots[0] as Pane;
      expect(newPane).toMatchObject({
        paneId: "pane-new",
        projectPath: "/repo/a",
        terminalTabs: [{ tabId: "tab-0b", label: null }],
        activeTerminalTabId: "tab-0b",
      });
      expect(result.target.focusedPaneId).toBe("pane-new");
    });

    it("is a no-op when the target pane has a different project and no empty slot is dropped on", () => {
      const source = onePane();
      const target = assignProjectToSlot(INITIAL_GRID_STATE, 1, "/repo/OTHER", "pane-1", "tab-1");

      const result = moveAcrossWindows(
        source,
        target,
        { kind: "tab", paneId: "pane-0", tabId: "tab-0", newPaneId: "unused" },
        1,
      );

      expect(result.source).toBe(source);
      expect(result.target).toBe(target);
    });

    it("is a no-op when the source tab is unknown", () => {
      const source = onePane();
      const target = INITIAL_GRID_STATE;

      const result = moveAcrossWindows(
        source,
        target,
        { kind: "tab", paneId: "pane-0", tabId: "does-not-exist", newPaneId: "unused" },
        0,
      );

      expect(result.source).toBe(source);
      expect(result.target).toBe(target);
    });
  });
});
