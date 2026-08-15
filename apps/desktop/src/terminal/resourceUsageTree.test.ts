import { describe, expect, it } from "vitest";
import type { Pane } from "../grid/gridState";
import { groupTabUsageByPane } from "./resourceUsageTree";

function pane(overrides: Partial<Pane> & Pick<Pane, "paneId" | "projectPath">): Pane {
  return {
    terminalTabs: [{ tabId: `${overrides.paneId}-tab-1`, label: null }],
    activeTerminalTabId: `${overrides.paneId}-tab-1`,
    showingFile: false,
    ...overrides,
  };
}

describe("groupTabUsageByPane", () => {
  it("gruppiert Samples nach der Pane, die den jeweiligen Tab gerade hält, und nummeriert wie der Tab-Chip (Position, nicht Id)", () => {
    const panes = [
      pane({
        paneId: "pane-a",
        projectPath: "/tmp/projekt-a",
        terminalTabs: [
          { tabId: "tab-1", label: null },
          { tabId: "tab-2", label: "Build" },
        ],
      }),
    ];
    const groups = groupTabUsageByPane(panes, [
      { tabId: "tab-1", memPercent: 5, cpuPercent: 1 },
      { tabId: "tab-2", memPercent: 3, cpuPercent: 2 },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.paneId).toBe("pane-a");
    expect(groups[0]?.projectName).toBe("projekt-a");
    expect(groups[0]?.tabs.map((row) => ({ number: row.number, label: row.label }))).toEqual([
      { number: 1, label: null },
      { number: 2, label: "Build" },
    ]);
  });

  it("lässt Tabs ohne Sample (vor dem ersten Tick) aus der Baumansicht weg, statt 0%/0% zu zeigen", () => {
    const panes = [
      pane({
        paneId: "pane-a",
        projectPath: "/tmp/projekt-a",
        terminalTabs: [
          { tabId: "tab-1", label: null },
          { tabId: "tab-2", label: null },
        ],
      }),
    ];
    const groups = groupTabUsageByPane(panes, [{ tabId: "tab-1", memPercent: 5, cpuPercent: 1 }]);
    expect(groups[0]?.tabs).toHaveLength(1);
    expect(groups[0]?.tabs[0]?.tabId).toBe("tab-1");
  });

  it("lässt eine Pane ganz weg, wenn keiner ihrer Tabs schon ein Sample hat", () => {
    const panes = [pane({ paneId: "pane-a", projectPath: "/tmp/projekt-a" })];
    expect(groupTabUsageByPane(panes, [])).toEqual([]);
  });

  it("sortiert Tabs innerhalb einer Pane absteigend nach dem höheren von RAM/CPU", () => {
    const panes = [
      pane({
        paneId: "pane-a",
        projectPath: "/tmp/projekt-a",
        terminalTabs: [
          { tabId: "cool", label: null },
          { tabId: "ram-heavy", label: null },
          { tabId: "cpu-heavy", label: null },
        ],
      }),
    ];
    const groups = groupTabUsageByPane(panes, [
      { tabId: "cool", memPercent: 1, cpuPercent: 1 },
      { tabId: "ram-heavy", memPercent: 45, cpuPercent: 2 },
      { tabId: "cpu-heavy", memPercent: 3, cpuPercent: 80 },
    ]);
    expect(groups[0]?.tabs.map((row) => row.tabId)).toEqual(["cpu-heavy", "ram-heavy", "cool"]);
  });

  it("sortiert auch die Panes selbst absteigend nach ihrem stärksten Tab", () => {
    const panes = [
      pane({ paneId: "quiet-pane", projectPath: "/tmp/quiet" }),
      pane({ paneId: "loud-pane", projectPath: "/tmp/loud" }),
    ];
    const groups = groupTabUsageByPane(panes, [
      { tabId: "quiet-pane-tab-1", memPercent: 2, cpuPercent: 1 },
      { tabId: "loud-pane-tab-1", memPercent: 50, cpuPercent: 1 },
    ]);
    expect(groups.map((group) => group.paneId)).toEqual(["loud-pane", "quiet-pane"]);
  });
});
