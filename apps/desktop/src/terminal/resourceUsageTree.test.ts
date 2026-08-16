import { describe, expect, it } from "vitest";
import type { Pane } from "../grid/gridState";
import { formatMemoryBytes, groupTabUsageByPane, groupTabUsageByWindow } from "./resourceUsageTree";

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
      { tabId: "tab-1", memPercent: 5, cpuPercent: 1, memBytes: 500, windowLabel: "main" },
      { tabId: "tab-2", memPercent: 3, cpuPercent: 2, memBytes: 300, windowLabel: "main" },
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
    const groups = groupTabUsageByPane(panes, [
      { tabId: "tab-1", memPercent: 5, cpuPercent: 1, memBytes: 500, windowLabel: "main" },
    ]);
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
      { tabId: "cool", memPercent: 1, cpuPercent: 1, memBytes: 100, windowLabel: "main" },
      { tabId: "ram-heavy", memPercent: 45, cpuPercent: 2, memBytes: 4500, windowLabel: "main" },
      { tabId: "cpu-heavy", memPercent: 3, cpuPercent: 80, memBytes: 300, windowLabel: "main" },
    ]);
    expect(groups[0]?.tabs.map((row) => row.tabId)).toEqual(["cpu-heavy", "ram-heavy", "cool"]);
  });

  it("sortiert auch die Panes selbst absteigend nach ihrem stärksten Tab", () => {
    const panes = [
      pane({ paneId: "quiet-pane", projectPath: "/tmp/quiet" }),
      pane({ paneId: "loud-pane", projectPath: "/tmp/loud" }),
    ];
    const groups = groupTabUsageByPane(panes, [
      { tabId: "quiet-pane-tab-1", memPercent: 2, cpuPercent: 1, memBytes: 200, windowLabel: "main" },
      { tabId: "loud-pane-tab-1", memPercent: 50, cpuPercent: 1, memBytes: 5000, windowLabel: "main" },
    ]);
    expect(groups.map((group) => group.paneId)).toEqual(["loud-pane", "quiet-pane"]);
  });
});

describe("groupTabUsageByWindow", () => {
  it("liefert nur die eigene Fenster-Gruppe mit voller Pane-Aufschlüsselung, wenn nur ein Fenster offen ist", () => {
    const panes = [
      pane({
        paneId: "pane-a",
        projectPath: "/tmp/projekt-a",
        terminalTabs: [{ tabId: "tab-1", label: null }],
      }),
    ];
    const groups = groupTabUsageByWindow(
      "main",
      [{ label: "main", title: "PaneCrew" }],
      panes,
      [{ tabId: "tab-1", memPercent: 5, cpuPercent: 1, memBytes: 500, windowLabel: "main" }],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.windowLabel).toBe("main");
    expect(groups[0]?.panes[0]?.paneId).toBe("pane-a");
    expect(groups[0]?.tabs).toEqual([]);
  });

  it("gruppiert Tabs fremder Fenster flach nach Fensterlabel, ohne Pane-Zuordnung", () => {
    const panes = [
      pane({
        paneId: "pane-a",
        projectPath: "/tmp/projekt-a",
        terminalTabs: [{ tabId: "own-tab", label: null }],
      }),
    ];
    const groups = groupTabUsageByWindow(
      "main",
      [
        { label: "main", title: "PaneCrew" },
        { label: "window-2", title: "PaneCrew — Fenster 2" },
      ],
      panes,
      [
        { tabId: "own-tab", memPercent: 5, cpuPercent: 1, memBytes: 500, windowLabel: "main" },
        { tabId: "foreign-tab-1", memPercent: 10, cpuPercent: 1, memBytes: 1000, windowLabel: "window-2" },
        { tabId: "foreign-tab-2", memPercent: 40, cpuPercent: 1, memBytes: 4000, windowLabel: "window-2" },
      ],
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]?.windowLabel).toBe("main");
    expect(groups[1]?.windowLabel).toBe("window-2");
    expect(groups[1]?.windowTitle).toBe("PaneCrew — Fenster 2");
    expect(groups[1]?.panes).toEqual([]);
    // Absteigend nach dominantem Prozentwert, stärkster zuerst.
    expect(groups[1]?.tabs.map((row) => row.tabId)).toEqual(["foreign-tab-2", "foreign-tab-1"]);
  });

  it("sortiert fremde Fenster absteigend nach ihrem stärksten Tab, eigenes Fenster bleibt immer zuerst", () => {
    const panes = [pane({ paneId: "pane-a", projectPath: "/tmp/quiet" })];
    const groups = groupTabUsageByWindow(
      "main",
      [
        { label: "main", title: "PaneCrew" },
        { label: "quiet-window", title: "Quiet" },
        { label: "loud-window", title: "Loud" },
      ],
      panes,
      [
        { tabId: "pane-a-tab-1", memPercent: 90, cpuPercent: 1, memBytes: 9000, windowLabel: "main" },
        { tabId: "quiet-tab", memPercent: 2, cpuPercent: 1, memBytes: 200, windowLabel: "quiet-window" },
        { tabId: "loud-tab", memPercent: 60, cpuPercent: 1, memBytes: 6000, windowLabel: "loud-window" },
      ],
    );

    expect(groups.map((group) => group.windowLabel)).toEqual(["main", "loud-window", "quiet-window"]);
  });

  it("lässt Tabs ohne Fensterzuordnung (Race beim Spawn) aus jeder Gruppe weg", () => {
    const groups = groupTabUsageByWindow("main", [{ label: "main", title: "PaneCrew" }], [], [
      { tabId: "orphan", memPercent: 5, cpuPercent: 1, memBytes: 500, windowLabel: null },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.panes).toEqual([]);
    expect(groups[0]?.tabs).toEqual([]);
  });
});

describe("formatMemoryBytes", () => {
  it("zeigt 0 Bytes als 0 MB", () => {
    expect(formatMemoryBytes(0)).toBe("0 MB");
  });

  it("rundet kleine Werte auf ganze MB", () => {
    expect(formatMemoryBytes(1.5 * 1024 * 1024)).toBe("2 MB");
    expect(formatMemoryBytes(256 * 1024 * 1024)).toBe("256 MB");
  });

  it("bleibt knapp unter der 1024-MB-Grenze bei MB", () => {
    expect(formatMemoryBytes(1023 * 1024 * 1024)).toBe("1023 MB");
  });

  it("wechselt zu GB, sobald der GERUNDETE MB-Wert 1024 erreicht (Rundungsdrift-Schutz)", () => {
    // 1023.6 MB würde auf 1024 MB runden, statt "1024 MB" anzuzeigen soll es
    // als GB erscheinen.
    const bytes = 1023.6 * 1024 * 1024;
    expect(formatMemoryBytes(bytes)).toBe("1.0 GB");
  });

  it("zeigt größere Werte als GB mit einer Nachkommastelle", () => {
    expect(formatMemoryBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });
});
