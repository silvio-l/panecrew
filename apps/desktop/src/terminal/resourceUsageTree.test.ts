import { describe, expect, it } from "vitest";
import type { Pane } from "../grid/gridState";
import {
  formatMemoryBytes,
  groupTabUsageByPane,
  groupTabUsageByWindow,
  paneStructuresFromPanes,
  type PaneStructure,
} from "./resourceUsageTree";

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

  it("gruppiert Tabs fremder Fenster flach nach Fensterlabel, solange dessen Pane-Struktur noch nicht über windowState.ts eingetroffen ist", () => {
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

  it("gibt einem fremden Fenster dieselbe Pane-Aufschlüsselung wie dem eigenen, sobald dessen Struktur über foreignPaneStructures vorliegt (der eigentliche Fix: Fenster 2 zeigte bislang keine Pane-Header/Tab-Umbenennungen)", () => {
    const panes = [pane({ paneId: "own-pane", projectPath: "/tmp/own" })];
    const foreignStructures: readonly PaneStructure[] = [
      {
        paneId: "foreign-pane",
        projectName: "panecrew",
        tabs: [{ tabId: "foreign-tab-1", label: "Build" }],
      },
    ];
    const groups = groupTabUsageByWindow(
      "main",
      [
        { label: "main", title: "PaneCrew" },
        { label: "window-2", title: "PaneCrew — Fenster 2" },
      ],
      panes,
      [
        { tabId: "own-pane-tab-1", memPercent: 1, cpuPercent: 1, memBytes: 100, windowLabel: "main" },
        { tabId: "foreign-tab-1", memPercent: 5, cpuPercent: 1, memBytes: 500, windowLabel: "window-2" },
      ],
      new Map([["window-2", foreignStructures]]),
    );

    const foreignGroup = groups[1];
    expect(foreignGroup?.windowLabel).toBe("window-2");
    expect(foreignGroup?.panes).toHaveLength(1);
    expect(foreignGroup?.panes[0]?.projectName).toBe("panecrew");
    expect(foreignGroup?.panes[0]?.tabs[0]?.label).toBe("Build");
    // Fully covered by the pane group -> no flat leftover row needed anymore.
    expect(foreignGroup?.tabs).toEqual([]);
  });

  it("fällt für Tabs eines fremden Fensters, die seine (bereits eingetroffene) Struktur noch nicht kennt, auf eine flache Restzeile zurück, statt sie verschwinden zu lassen", () => {
    const foreignStructures: readonly PaneStructure[] = [
      { paneId: "foreign-pane", projectName: "panecrew", tabs: [{ tabId: "known-tab", label: null }] },
    ];
    const groups = groupTabUsageByWindow(
      "main",
      [{ label: "main", title: "PaneCrew" }, { label: "window-2", title: "PaneCrew — Fenster 2" }],
      [],
      [
        { tabId: "known-tab", memPercent: 1, cpuPercent: 1, memBytes: 100, windowLabel: "window-2" },
        { tabId: "brand-new-tab", memPercent: 2, cpuPercent: 1, memBytes: 200, windowLabel: "window-2" },
      ],
      new Map([["window-2", foreignStructures]]),
    );

    const foreignGroup = groups[1];
    expect(foreignGroup?.panes).toHaveLength(1);
    expect(foreignGroup?.tabs.map((row) => row.tabId)).toEqual(["brand-new-tab"]);
    expect(foreignGroup?.tabs[0]?.label).toBeNull();
  });

  it("reiht ein fremdes Fenster nach seinem stärksten Tab ein, egal ob der in einer Pane-Gruppe oder in der flachen Restzeile landet", () => {
    const foreignStructures: readonly PaneStructure[] = [
      { paneId: "foreign-pane", projectName: "panecrew", tabs: [{ tabId: "quiet-grouped-tab", label: null }] },
    ];
    const groups = groupTabUsageByWindow(
      "main",
      [
        { label: "main", title: "PaneCrew" },
        { label: "window-2", title: "PaneCrew — Fenster 2" },
      ],
      [pane({ paneId: "own-pane", projectPath: "/tmp/own" })],
      [
        { tabId: "own-pane-tab-1", memPercent: 1, cpuPercent: 1, memBytes: 100, windowLabel: "main" },
        { tabId: "quiet-grouped-tab", memPercent: 2, cpuPercent: 1, memBytes: 200, windowLabel: "window-2" },
        // Ungrouped (no structure known for it), but the window's heaviest
        // consumer -> must still determine its placement.
        { tabId: "loud-ungrouped-tab", memPercent: 95, cpuPercent: 1, memBytes: 9500, windowLabel: "window-2" },
      ],
      new Map([["window-2", foreignStructures]]),
    );

    expect(groups.map((group) => group.windowLabel)).toEqual(["main", "window-2"]);
  });
});

describe("paneStructuresFromPanes", () => {
  it("leitet Fenster-agnostische Struktur (Projektname statt Pfad, nur tabId+label) aus dem Grid-State ab — dieselbe Form, die TitleBar.tsx unter dem pane-tree-Topic publiziert", () => {
    const panes = [
      pane({
        paneId: "pane-a",
        projectPath: "/tmp/mein-projekt",
        terminalTabs: [
          { tabId: "tab-1", label: null },
          { tabId: "tab-2", label: "Build" },
        ],
      }),
    ];
    expect(paneStructuresFromPanes(panes)).toEqual([
      {
        paneId: "pane-a",
        projectName: "mein-projekt",
        tabs: [
          { tabId: "tab-1", label: null },
          { tabId: "tab-2", label: "Build" },
        ],
      },
    ]);
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
