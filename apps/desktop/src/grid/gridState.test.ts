import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE,
  GRID_TEMPLATES,
  INITIAL_GRID_STATE,
  activePanes,
  assignProjectToSlot,
  closePane,
  closeFileTab,
  closeFileTabsUnder,
  closeTerminalTab,
  enterFocusMode,
  exitFocusMode,
  firstEmptySlotIndex,
  focusModeSelectSlot,
  focusPane,
  focusedProjectPath,
  moveTerminalTab,
  moveTerminalTabToEmptySlot,
  movePaneToEmptySlot,
  moveTab,
  nextGrowthTemplate,
  nextPaneId,
  openTerminalTab,
  openFileTab,
  renameTerminalTab,
  setSplitRatios,
  swapPanes,
  switchTemplate,
  switchToFileTab,
  switchToTerminalTab,
  terminalTabs,
  templateSwitchBlockReason,
  trackShape,
  type GridState,
  type Pane,
} from "./gridState";

describe("gridState", () => {
  describe("generic pane tabs (Ticket 34)", () => {
    it("stores Terminal- and File-Tabs in one ordered list and activates a newly opened file", () => {
      const withPane = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "terminal-0",
      );

      const next = openFileTab(
        withPane,
        "pane-0",
        "file-0",
        "src/App.tsx",
      );

      expect(next.slots[0]).toEqual({
        paneId: "pane-0",
        projectPath: "/repo/a",
        tabs: [
          {
            kind: "terminal",
            tabId: "terminal-0",
            label: null,
            adapterId: null,
          },
          { kind: "file", tabId: "file-0", path: "src/App.tsx" },
        ],
        activeTabId: "file-0",
      });
    });

    it("reuses an already open file instead of creating a duplicate tab", () => {
      const withFile = openFileTab(
        assignProjectToSlot(
          INITIAL_GRID_STATE,
          0,
          "/repo/a",
          "pane-0",
          "terminal-0",
        ),
        "pane-0",
        "file-0",
        "src/App.tsx",
      );

      const next = openFileTab(
        openTerminalTab(withFile, "pane-0", "terminal-1"),
        "pane-0",
        "unused-file-id",
        "src/App.tsx",
      );

      expect((next.slots[0] as Pane).tabs.map((tab) => tab.tabId)).toEqual([
        "terminal-0",
        "file-0",
        "terminal-1",
      ]);
      expect((next.slots[0] as Pane).activeTabId).toBe("file-0");
    });

    it("reorders tabs freely across kinds inside one pane", () => {
      const withTabs = openTerminalTab(
        openFileTab(
          assignProjectToSlot(
            INITIAL_GRID_STATE,
            0,
            "/repo/a",
            "pane-0",
            "terminal-0",
          ),
          "pane-0",
          "file-0",
          "src/App.tsx",
        ),
        "pane-0",
        "terminal-1",
      );

      const next = moveTab(withTabs, "pane-0", "file-0", 0);

      expect((next.slots[0] as Pane).tabs.map((tab) => tab.tabId)).toEqual([
        "file-0",
        "terminal-0",
        "terminal-1",
      ]);
      expect((next.slots[0] as Pane).activeTabId).toBe("file-0");
    });

    it("removes a file-only pane when its final tab is closed", () => {
      const withFileOnly = moveTerminalTab(
        openFileTab(
          assignProjectToSlot(
            assignProjectToSlot(
              INITIAL_GRID_STATE,
              0,
              "/repo/a",
              "pane-0",
              "terminal-0",
            ),
            1,
            "/repo/a",
            "pane-1",
            "terminal-1",
          ),
          "pane-0",
          "file-0",
          "README.md",
        ),
        "pane-0",
        "terminal-0",
        "pane-1",
      );

      const next = closeFileTab(
        focusPane(withFileOnly, "pane-0"),
        "pane-0",
        "file-0",
      );

      expect(next.slots[0]).toBeNull();
      expect(next.focusedPaneId).toBe("pane-1");
    });
  });

  it("startet mit Quad und vier leeren Slots", () => {
    expect(INITIAL_GRID_STATE.template).toBe(DEFAULT_TEMPLATE);
    expect(INITIAL_GRID_STATE.template).toBe("quad");
    expect(INITIAL_GRID_STATE.slots).toEqual([null, null, null, null]);
    expect(INITIAL_GRID_STATE.focusedPaneId).toBeNull();
    expect(INITIAL_GRID_STATE.maximizedPaneId).toBeNull();
  });

  it.each(GRID_TEMPLATES.map((t) => [t.id, t.slotCount] as const))(
    "Template %s hat %i Slot(s)",
    (id, count) => {
      const state = switchTemplate(INITIAL_GRID_STATE, id);
      expect(state.slots).toHaveLength(count);
    },
  );

  it("Zuweisung füllt genau den adressierten Slot mit genau einem aktiven Terminal-Tab", () => {
    const next = assignProjectToSlot(
      INITIAL_GRID_STATE,
      2,
      "/repo/storefront",
      "pane-1",
      "tab-1",
    );
    expect(next.slots).toEqual([
      null,
      null,
      {
        paneId: "pane-1",
        projectPath: "/repo/storefront",
        tabs: [
          {
            kind: "terminal",
            tabId: "tab-1",
            label: null,
            adapterId: null,
          },
        ],
        activeTabId: "tab-1",
      },
      null,
    ]);
  });

  it("übernimmt eine übergebene adapterId für den ersten Tab einer neu zugewiesenen Pane (Ticket 35)", () => {
    const next = assignProjectToSlot(
      INITIAL_GRID_STATE,
      2,
      "/repo/storefront",
      "pane-1",
      "tab-1",
      "codex", // brandlint-ok: canonical adapter id, functional
    );
    expect(terminalTabs(next.slots[2] as Pane)).toEqual([
      { kind: "terminal", tabId: "tab-1", label: null, adapterId: "codex" }, // brandlint-ok: canonical adapter id, functional
    ]);
  });

  it("erlaubt dasselbe Projekt in zwei Slots ohne Dedup", () => {
    const step1 = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/storefront",
      "pane-1",
      "tab-1",
    );
    const step2 = assignProjectToSlot(
      step1,
      1,
      "/repo/storefront",
      "pane-2",
      "tab-2",
    );
    expect(activePanes(step2).map((p) => p.paneId)).toEqual([
      "pane-1",
      "pane-2",
    ]);
  });

  it("ersetzt bei Neuzuweisung eines belegten Slots mit neuer paneId", () => {
    const step1 = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/storefront",
      "pane-1",
      "tab-1",
    );
    const step2 = assignProjectToSlot(
      step1,
      0,
      "/repo/other",
      "pane-2",
      "tab-2",
    );
    expect(step2.slots[0]).toMatchObject({
      paneId: "pane-2",
      projectPath: "/repo/other",
    });
  });

  it("setzt focusedPaneId auf die neu zugewiesene Pane", () => {
    const next = assignProjectToSlot(
      INITIAL_GRID_STATE,
      3,
      "/repo/storefront",
      "pane-1",
      "tab-1",
    );
    expect(next.focusedPaneId).toBe("pane-1");
  });

  it.each([-1, 4, 99])(
    "lässt den State bei ungültigem Slot-Index %i unverändert",
    (index) => {
      const next = assignProjectToSlot(
        INITIAL_GRID_STATE,
        index,
        "/repo/storefront",
        "pane-1",
        "tab-1",
      );
      expect(next).toBe(INITIAL_GRID_STATE);
    },
  );

  it("erhält beim Wachsen die Indizes exakt", () => {
    const withPane = assignProjectToSlot(
      switchTemplate(INITIAL_GRID_STATE, "split"),
      1,
      "/repo/storefront",
      "pane-1",
      "tab-1",
    );
    const grown = switchTemplate(withPane, "row-4");
    expect(grown.slots.map((s) => (s)?.paneId ?? null)).toEqual([
      null,
      "pane-1",
      null,
      null,
    ]);
  });

  it("kompaktiert beim passenden Schrumpfen der Reihe nach (nicht per Index)", () => {
    const quad = INITIAL_GRID_STATE;
    const withPanes = assignProjectToSlot(
      assignProjectToSlot(quad, 0, "/repo/a", "pane-0", "tab-0"),
      3,
      "/repo/d",
      "pane-3",
      "tab-3",
    );
    const shrunk = switchTemplate(withPanes, "split");
    expect(shrunk.slots.map((s) => (s)?.paneId)).toEqual([
      "pane-0",
      "pane-3",
    ]);
  });

  it("blockiert Schrumpfen, das nicht passt, und liefert dieselbe Referenz", () => {
    const threeActive = assignProjectToSlot(
      assignProjectToSlot(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        1,
        "/repo/b",
        "pane-1",
        "tab-1",
      ),
      2,
      "/repo/c",
      "pane-2",
      "tab-2",
    );
    const reason = templateSwitchBlockReason(threeActive, "split");
    expect(reason?.active).toBe(3);
    expect(reason?.targetSlots).toBe(2);

    const attempted = switchTemplate(threeActive, "split");
    expect(attempted).toBe(threeActive);
  });

  it("behandelt den Wechsel aufs aktuelle Template als No-Op", () => {
    expect(switchTemplate(INITIAL_GRID_STATE, "quad")).toBe(
      INITIAL_GRID_STATE,
    );
  });

  it("erlaubt Schrumpfen bei null aktiven Panes immer", () => {
    const empty: GridState = INITIAL_GRID_STATE;
    expect(templateSwitchBlockReason(empty, "single")).toBeNull();
    const shrunk = switchTemplate(empty, "single");
    expect(shrunk.template).toBe("single");
    expect(shrunk.slots).toEqual([null]);
  });

  // Regressionstest für den Bugfix 2026-08-16 (User-Report: ein Klick auf
  // "Zuletzt geöffnet" hat vorher stillschweigend die fokussierte Pane
  // überschrieben) — `App.tsx`s menü-getriebenes Öffnen zielt jetzt
  // ausschließlich über diese Funktion, nie mehr über eine
  // fokussierte-Pane-zuerst-Regel.
  describe("firstEmptySlotIndex", () => {
    it("findet den ersten leeren Slot in Template-Reihenfolge", () => {
      const withGapAtTwo = assignProjectToSlot(
        INITIAL_GRID_STATE,
        3,
        "/repo/storefront",
        "pane-1",
        "tab-1",
      );
      expect(firstEmptySlotIndex(withGapAtTwo)).toBe(0);
    });

    it("überspringt bereits belegte Slots", () => {
      let state = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/storefront",
        "pane-1",
        "tab-1",
      );
      state = assignProjectToSlot(state, 1, "/repo/api", "pane-2", "tab-2");
      expect(firstEmptySlotIndex(state)).toBe(2);
    });

    it("liefert -1 bei komplett vollem Grid — niemals einen belegten Index", () => {
      let state = INITIAL_GRID_STATE;
      state.slots.forEach((_, index) => {
        state = assignProjectToSlot(
          state,
          index,
          `/repo/project-${index}`,
          `pane-${index}`,
          `tab-${index}`,
        );
      });
      expect(firstEmptySlotIndex(state)).toBe(-1);
    });
  });

  describe("nextGrowthTemplate ('Pane teilen')", () => {
    it("wächst immer um genau einen Slot", () => {
      expect(nextGrowthTemplate("single")).toBe("split");
      expect(nextGrowthTemplate("split")).toBe("two-over-one");
    });

    it("nimmt bei mehreren Templates mit derselben Ziel-Slot-Zahl das erste in Tabellenreihenfolge", () => {
      expect(nextGrowthTemplate("two-over-one")).toBe("quad");
      expect(nextGrowthTemplate("one-over-two")).toBe("quad");
      expect(nextGrowthTemplate("row-3")).toBe("quad");
    });

    it("liefert null an der Obergrenze", () => {
      expect(nextGrowthTemplate("quad")).toBeNull();
      expect(nextGrowthTemplate("row-4")).toBeNull();
    });

    it("der alte slots.length landet nach switchTemplate exakt im neuen Slot (App.tsx::splitFocusedPane's Annahme)", () => {
      // single -> split: alter slots.length (1) muss der neue Index (1) sein.
      const single = switchTemplate(INITIAL_GRID_STATE, "single");
      const oldLength = single.slots.length;
      const target = nextGrowthTemplate(single.template);
      if (target === null) throw new Error("erwartetes Wachstum fehlt");
      const grown = switchTemplate(single, target);
      const withNewPane = assignProjectToSlot(grown, oldLength, "/repo/new", "pane-new", "tab-new");
      expect(withNewPane.slots[oldLength]?.paneId).toBe("pane-new");
      expect(withNewPane.slots.length).toBe(oldLength + 1);
    });
  });

  it("closePane leert nur den einen Slot und lässt andere unangetastet", () => {
    const withTwo = assignProjectToSlot(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
      1,
      "/repo/b",
      "pane-1",
      "tab-1",
    );
    const next = closePane(withTwo, "pane-0");
    expect(next.slots[0]).toBeNull();
    expect((next.slots[1] as Pane | null)?.paneId).toBe("pane-1");
  });

  it("verschiebt den Fokus beim Schließen der fokussierten Pane auf die erste verbleibende", () => {
    const withTwo = assignProjectToSlot(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
      1,
      "/repo/b",
      "pane-1",
      "tab-1",
    );
    expect(withTwo.focusedPaneId).toBe("pane-1");
    const next = closePane(withTwo, "pane-1");
    expect(next.focusedPaneId).toBe("pane-0");
  });

  it("setzt den Fokus auf null, wenn keine Pane mehr übrig ist", () => {
    const withOne = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/a",
      "pane-0",
      "tab-0",
    );
    const next = closePane(withOne, "pane-0");
    expect(next.focusedPaneId).toBeNull();
  });

  it("lässt den State bei unbekannter paneId unverändert", () => {
    const withOne = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/a",
      "pane-0",
      "tab-0",
    );
    expect(closePane(withOne, "does-not-exist")).toBe(withOne);
  });

  it("liefert den Projektpfad der fokussierten Pane", () => {
    const withOne = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/a",
      "pane-0",
      "tab-0",
    );
    expect(focusedProjectPath(withOne)).toBe("/repo/a");
    expect(focusedProjectPath(INITIAL_GRID_STATE)).toBeNull();
  });

  it("wechselt den Fokus auf eine andere belegte Pane", () => {
    const withTwo = assignProjectToSlot(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
      1,
      "/repo/b",
      "pane-1",
      "tab-1",
    );
    expect(withTwo.focusedPaneId).toBe("pane-1");
    const next = focusPane(withTwo, "pane-0");
    expect(next.focusedPaneId).toBe("pane-0");
    expect(focusedProjectPath(next)).toBe("/repo/a");
  });

  it("ist ein No-Op (identische Referenz), wenn die Pane bereits fokussiert ist", () => {
    const withOne = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/a",
      "pane-0",
      "tab-0",
    );
    expect(focusPane(withOne, "pane-0")).toBe(withOne);
  });

  it("lässt den State bei unbekannter paneId unverändert (focusPane)", () => {
    const withOne = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/a",
      "pane-0",
      "tab-0",
    );
    expect(focusPane(withOne, "does-not-exist")).toBe(withOne);
  });

  describe("openTerminalTab", () => {
    it("hängt einen weiteren Terminal-Tab an und macht ihn aktiv", () => {
      const withOne = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "tab-0",
      );
      const next = openTerminalTab(withOne, "pane-0", "tab-1");
      const pane = next.slots[0] as Pane;
      expect(terminalTabs(pane)).toEqual([
        { kind: "terminal", tabId: "tab-0", label: null, adapterId: null },
        { kind: "terminal", tabId: "tab-1", label: null, adapterId: null },
      ]);
      expect(pane.activeTabId).toBe("tab-1");
    });

    it("übernimmt eine übergebene adapterId für den neuen Tab, ohne den bestehenden zu verändern (Ticket 35)", () => {
      const withOne = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "tab-0",
      );
      const next = openTerminalTab(withOne, "pane-0", "tab-1", "claude"); // brandlint-ok: canonical adapter id, functional
      const pane = next.slots[0] as Pane;
      expect(terminalTabs(pane)).toEqual([
        { kind: "terminal", tabId: "tab-0", label: null, adapterId: null },
        { kind: "terminal", tabId: "tab-1", label: null, adapterId: "claude" }, // brandlint-ok: canonical adapter id, functional
      ]);
    });

    it("verlässt dabei einen gerade sichtbaren File-Tab", () => {
      const pane = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "tab-0",
      );
      const withFile = openFileTab(pane, "pane-0", "file-0", "src/App.tsx");
      const next = openTerminalTab(withFile, "pane-0", "tab-1");
      expect((next.slots[0] as Pane).activeTabId).toBe("tab-1");
    });

    it("lässt den State bei unbekannter paneId unverändert", () => {
      expect(openTerminalTab(INITIAL_GRID_STATE, "does-not-exist", "tab-1")).toBe(
        INITIAL_GRID_STATE,
      );
    });
  });

  describe("closeTerminalTab", () => {
    function twoTabPane(): GridState {
      return openTerminalTab(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        "pane-0",
        "tab-1",
      );
    }

    it("entfernt einen Terminal-Tab, ohne die anderen anzutasten", () => {
      const withTwo = twoTabPane();
      const next = closeTerminalTab(withTwo, "pane-0", "tab-0");
      expect(terminalTabs(next.slots[0] as Pane)).toEqual([
        { kind: "terminal", tabId: "tab-1", label: null, adapterId: null },
      ]);
    });

    it("übernimmt der Vorgänger, wenn der aktive Tab geschlossen wird", () => {
      const withThree = openTerminalTab(twoTabPane(), "pane-0", "tab-2");
      const next = closeTerminalTab(withThree, "pane-0", "tab-2");
      expect((next.slots[0] as Pane).activeTabId).toBe("tab-1");
    });

    it("übernimmt der Nachfolger, wenn Tab 0 aktiv war und geschlossen wird", () => {
      const withTwo = twoTabPane();
      const backToFirst = switchToTerminalTab(withTwo, "pane-0", "tab-0");
      const next = closeTerminalTab(backToFirst, "pane-0", "tab-0");
      expect((next.slots[0] as Pane).activeTabId).toBe("tab-1");
    });

    it("lässt den letzten verbleibenden Terminal-Tab nicht schließen (No-Op)", () => {
      const withOne = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "tab-0",
      );
      expect(closeTerminalTab(withOne, "pane-0", "tab-0")).toBe(withOne);
    });

    it("lässt den State bei unbekannter tabId unverändert", () => {
      const withTwo = twoTabPane();
      expect(closeTerminalTab(withTwo, "pane-0", "does-not-exist")).toBe(
        withTwo,
      );
    });
  });

  describe("switchToTerminalTab / switchToFileTab", () => {
    it("wechselt zu einem anderen Terminal-Tab derselben Pane", () => {
      const withTwo = openTerminalTab(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        "pane-0",
        "tab-1",
      );
      const next = switchToTerminalTab(withTwo, "pane-0", "tab-0");
      expect((next.slots[0] as Pane).activeTabId).toBe("tab-0");
    });

    it("wechselt zu einem File-Tab über dessen stabile Identität", () => {
      const withFile = openFileTab(
        assignProjectToSlot(
          INITIAL_GRID_STATE,
          0,
          "/repo/a",
          "pane-0",
          "tab-0",
        ),
        "pane-0",
        "file-0",
        "src/App.tsx",
      );
      const backToTerminal = switchToTerminalTab(withFile, "pane-0", "tab-0");
      const next = switchToFileTab(backToTerminal, "pane-0", "file-0");
      const pane = next.slots[0] as Pane;
      expect(pane.activeTabId).toBe("file-0");
    });

    it("switchToFileTab ist ein No-Op, wenn der File-Tab bereits sichtbar ist", () => {
      const withFile = openFileTab(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        "pane-0",
        "file-0",
        "src/App.tsx",
      );
      expect(switchToFileTab(withFile, "pane-0", "file-0")).toBe(withFile);
    });

    it("switchToTerminalTab ist ein No-Op, wenn der Tab bereits aktiv ist und kein File-Tab sichtbar war", () => {
      const withOne = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "tab-0",
      );
      expect(switchToTerminalTab(withOne, "pane-0", "tab-0")).toBe(withOne);
    });

    it("switchToTerminalTab lässt den State bei unbekannter paneId/tabId unverändert", () => {
      const withOne = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "tab-0",
      );
      expect(switchToTerminalTab(withOne, "pane-0", "does-not-exist")).toBe(
        withOne,
      );
      expect(switchToTerminalTab(withOne, "does-not-exist", "tab-0")).toBe(
        withOne,
      );
    });
  });

  describe("moveTerminalTab (Ticket 32)", () => {
    /** Zwei Panes desselben Projekts, die linke mit zwei Terminal-Tabs. */
    function twoPanesSameProject(): GridState {
      const withPanes = assignProjectToSlot(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        1,
        "/repo/a",
        "pane-1",
        "tab-1",
      );
      return openTerminalTab(withPanes, "pane-0", "tab-0b");
    }

    it("hängt den Tab in die Ziel-Pane, macht ihn dort aktiv und holt den Fokus mit", () => {
      const start = twoPanesSameProject();
      const next = moveTerminalTab(start, "pane-0", "tab-0b", "pane-1");

      const target = next.slots[1] as Pane;
      expect(terminalTabs(target).map((tab) => tab.tabId)).toEqual([
        "tab-1",
        "tab-0b",
      ]);
      expect(target.activeTabId).toBe("tab-0b");
      expect(next.focusedPaneId).toBe("pane-1");
    });

    it("lässt die Quell-Pane mit ihrem verbleibenden Tab aktiv zurück", () => {
      // "tab-0b" war nach `openTerminalTab` der aktive Tab der Quelle — nach
      // dem Wegziehen muss dort ein anderer übernehmen, sonst zeigte die
      // Pane auf einen Tab, den sie nicht mehr hat.
      const start = twoPanesSameProject();
      const next = moveTerminalTab(start, "pane-0", "tab-0b", "pane-1");

      const source = next.slots[0] as Pane;
      expect(terminalTabs(source).map((tab) => tab.tabId)).toEqual(["tab-0"]);
      expect(source.activeTabId).toBe("tab-0");
    });

    it("keeps File-Tabs in the source Pane when its only Terminal moves", () => {
      const start = openFileTab(
        assignProjectToSlot(
          assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
          1,
          "/repo/a",
          "pane-1",
          "tab-1",
        ),
        "pane-0",
        "file-0",
        "src/App.tsx",
      );

      const next = moveTerminalTab(start, "pane-0", "tab-0", "pane-1");

      expect((next.slots[0] as Pane).tabs).toEqual([
        { kind: "file", tabId: "file-0", path: "src/App.tsx" },
      ]);
      expect((next.slots[0] as Pane).activeTabId).toBe("file-0");
      expect(terminalTabs(next.slots[1] as Pane).map((tab) => tab.tabId)).toEqual([
        "tab-1",
        "tab-0",
      ]);
    });

    it("lässt den aktiven Tab der Quelle unangetastet, wenn ein INAKTIVER wegzieht", () => {
      const start = switchToTerminalTab(twoPanesSameProject(), "pane-0", "tab-0");
      const next = moveTerminalTab(start, "pane-0", "tab-0b", "pane-1");
      expect((next.slots[0] as Pane).activeTabId).toBe("tab-0");
    });

    it("verschiebt den Tab als identisches Objekt (Name/PTY-Zuordnung bleiben)", () => {
      const start = renameTerminalTab(
        twoPanesSameProject(),
        "pane-0",
        "tab-0b",
        "Build",
      );
      const movedBefore = terminalTabs(start.slots[0] as Pane)[1];
      const next = moveTerminalTab(start, "pane-0", "tab-0b", "pane-1");
      expect(terminalTabs(next.slots[1] as Pane)[1]).toBe(movedBefore);
    });

    it("ist ein No-Op über Projektgrenzen hinweg (identische Referenz)", () => {
      const start = openTerminalTab(
        assignProjectToSlot(
          assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
          1,
          "/repo/b",
          "pane-1",
          "tab-1",
        ),
        "pane-0",
        "tab-0b",
      );
      expect(moveTerminalTab(start, "pane-0", "tab-0b", "pane-1")).toBe(start);
    });

    it("leert den Quell-Slot, wenn der LETZTE Tab wegzieht (Präzisions-Runde)", () => {
      // Nutzer-Entscheidung: "auch das letzte Tab eines Panes soll
      // verschiebbar sein, das würde dann halt einfach nur anschließend
      // automatisch den Slot frei machen und das Pane schließen."
      const start = assignProjectToSlot(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        1,
        "/repo/a",
        "pane-1",
        "tab-1",
      );
      const next = moveTerminalTab(start, "pane-0", "tab-0", "pane-1");

      expect(next.slots[0]).toBeNull();
      const target = next.slots[1] as Pane;
      expect(terminalTabs(target).map((tab) => tab.tabId)).toEqual([
        "tab-1",
        "tab-0",
      ]);
      expect(target.activeTabId).toBe("tab-0");
      expect(next.focusedPaneId).toBe("pane-1");
    });

    it("räumt beim Leeren der Quelle einen auf sie zeigenden Fokus-Modus ab (dieselbe Nachsorge wie closePane)", () => {
      const start = enterFocusMode(
        assignProjectToSlot(
          assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
          1,
          "/repo/a",
          "pane-1",
          "tab-1",
        ),
        "pane-0",
      );
      const next = moveTerminalTab(start, "pane-0", "tab-0", "pane-1");
      expect(next.maximizedPaneId).toBeNull();
    });

    it("fügt am übergebenen Einfüge-Slot der Ziel-Leiste ein, nicht nur am Ende", () => {
      const start = openTerminalTab(twoPanesSameProject(), "pane-1", "tab-1b");
      // Ziel-Leiste vor dem Zug: [tab-1, tab-1b] — Slot 1 heißt "dazwischen".
      const next = moveTerminalTab(start, "pane-0", "tab-0b", "pane-1", 1);

      const target = next.slots[1] as Pane;
      expect(terminalTabs(target).map((tab) => tab.tabId)).toEqual([
        "tab-1",
        "tab-0b",
        "tab-1b",
      ]);
      expect(target.activeTabId).toBe("tab-0b");
    });

    it("sortiert innerhalb DERSELBEN Pane um und macht den gezogenen Tab aktiv", () => {
      // Drei Tabs in pane-0: [tab-0, tab-0b, tab-0c]. tab-0 an Slot 2
      // (zwischen tab-0b und tab-0c, vor dem Herauslösen gezählt) heißt
      // End-Position 1.
      const start = openTerminalTab(twoPanesSameProject(), "pane-0", "tab-0c");
      const next = moveTerminalTab(start, "pane-0", "tab-0", "pane-0", 2);

      const pane = next.slots[0] as Pane;
      expect(terminalTabs(pane).map((tab) => tab.tabId)).toEqual([
        "tab-0b",
        "tab-0",
        "tab-0c",
      ]);
      expect(pane.activeTabId).toBe("tab-0");
      expect(next.focusedPaneId).toBe("pane-0");
    });

    it("sortiert nach vorn: ein Slot VOR der eigenen Position zählt unverändert", () => {
      const start = openTerminalTab(twoPanesSameProject(), "pane-0", "tab-0c");
      const next = moveTerminalTab(start, "pane-0", "tab-0c", "pane-0", 0);
      expect(
        terminalTabs(next.slots[0] as Pane).map((tab) => tab.tabId),
      ).toEqual(["tab-0c", "tab-0", "tab-0b"]);
    });

    it("ist ein No-Op beim Umsortieren auf die eigene Position (auch über die Nachbar-Slots)", () => {
      const start = twoPanesSameProject();
      // tab-0 steht an Index 0: Slot 0 (direkt davor) und Slot 1 (direkt
      // dahinter) ergeben beide dieselbe End-Position.
      expect(moveTerminalTab(start, "pane-0", "tab-0", "pane-0", 0)).toBe(start);
      expect(moveTerminalTab(start, "pane-0", "tab-0", "pane-0", 1)).toBe(start);
      // Ohne Slot-Angabe: ans Ende — für den letzten Tab ebenfalls die
      // eigene Position.
      expect(moveTerminalTab(start, "pane-0", "tab-0b", "pane-0")).toBe(start);
    });

    it("ist ein No-Op bei einem Einfüge-Slot außerhalb der Ziel-Leiste", () => {
      const start = twoPanesSameProject();
      expect(moveTerminalTab(start, "pane-0", "tab-0b", "pane-1", -1)).toBe(
        start,
      );
      expect(moveTerminalTab(start, "pane-0", "tab-0b", "pane-1", 2)).toBe(
        start,
      );
    });

    it("ist ein No-Op bei unbekannter Pane und unbekanntem Tab", () => {
      const start = twoPanesSameProject();
      expect(moveTerminalTab(start, "gibt-es-nicht", "tab-0b", "pane-1")).toBe(
        start,
      );
      expect(moveTerminalTab(start, "pane-0", "tab-0b", "gibt-es-nicht")).toBe(
        start,
      );
      expect(moveTerminalTab(start, "pane-0", "gibt-es-nicht", "pane-1")).toBe(
        start,
      );
    });
  });

  describe("moveTerminalTabToEmptySlot", () => {
    /** Eine Pane mit zwei Tabs in Slot 0, Slots 1–3 leer. */
    function onePaneTwoTabs(): GridState {
      return openTerminalTab(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        "pane-0",
        "tab-0b",
      );
    }

    it("erzeugt im Ziel-Slot eine frische Pane im Projekt der Quelle, mit dem Tab als aktivem, und holt den Fokus mit", () => {
      const start = onePaneTwoTabs();
      const next = moveTerminalTabToEmptySlot(start, "pane-0", "tab-0b", 2, "pane-neu");

      const created = next.slots[2] as Pane;
      expect(created.paneId).toBe("pane-neu");
      expect(created.projectPath).toBe("/repo/a");
      expect(terminalTabs(created).map((tab) => tab.tabId)).toEqual(["tab-0b"]);
      expect(created.activeTabId).toBe("tab-0b");
      expect(next.focusedPaneId).toBe("pane-neu");
      // Die Quelle behält ihren verbleibenden Tab als aktiven.
      const source = next.slots[0] as Pane;
      expect(terminalTabs(source).map((tab) => tab.tabId)).toEqual(["tab-0"]);
      expect(source.activeTabId).toBe("tab-0");
    });

    it("verschiebt den Tab als identisches Objekt (Name/PTY-Zuordnung bleiben)", () => {
      const start = renameTerminalTab(onePaneTwoTabs(), "pane-0", "tab-0b", "Build");
      const movedBefore = terminalTabs(start.slots[0] as Pane)[1];
      const next = moveTerminalTabToEmptySlot(start, "pane-0", "tab-0b", 1, "pane-neu");
      expect(terminalTabs(next.slots[1] as Pane)[0]).toBe(movedBefore);
    });

    it("leert den Quell-Slot, wenn der LETZTE Tab wegzieht", () => {
      const start = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "tab-0",
      );
      const next = moveTerminalTabToEmptySlot(start, "pane-0", "tab-0", 3, "pane-neu");
      expect(next.slots[0]).toBeNull();
      expect(terminalTabs(next.slots[3] as Pane).map((tab) => tab.tabId)).toEqual([
        "tab-0",
      ]);
    });

    it("räumt beim Leeren der Quelle einen auf sie zeigenden Fokus-Modus ab", () => {
      const start = enterFocusMode(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        "pane-0",
      );
      const next = moveTerminalTabToEmptySlot(start, "pane-0", "tab-0", 1, "pane-neu");
      expect(next.maximizedPaneId).toBeNull();
    });

    it("ist ein No-Op auf einen BELEGTEN Slot (Wettlauf mit einer parallelen Zuweisung)", () => {
      const start = onePaneTwoTabs();
      expect(
        moveTerminalTabToEmptySlot(start, "pane-0", "tab-0b", 0, "pane-neu"),
      ).toBe(start);
    });

    it("ist ein No-Op bei einem Slot-Index außerhalb des Templates", () => {
      const start = onePaneTwoTabs();
      expect(
        moveTerminalTabToEmptySlot(start, "pane-0", "tab-0b", -1, "pane-neu"),
      ).toBe(start);
      expect(
        moveTerminalTabToEmptySlot(start, "pane-0", "tab-0b", 4, "pane-neu"),
      ).toBe(start);
    });

    it("ist ein No-Op bei unbekannter Quelle und unbekanntem Tab", () => {
      const start = onePaneTwoTabs();
      expect(
        moveTerminalTabToEmptySlot(start, "gibt-es-nicht", "tab-0b", 1, "pane-neu"),
      ).toBe(start);
      expect(
        moveTerminalTabToEmptySlot(start, "pane-0", "gibt-es-nicht", 1, "pane-neu"),
      ).toBe(start);
    });
  });

  describe("movePaneToEmptySlot", () => {
    /** Eine Pane mit zwei Tabs in Slot 0, Slots 1–3 leer. */
    function onePaneTwoTabs(): GridState {
      return openTerminalTab(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        "pane-0",
        "tab-0b",
      );
    }

    it("stellt die Pane als IDENTISCHES Objekt in den Ziel-Slot und leert die Quelle", () => {
      // Identität ist hier die eigentliche Zusicherung: die `paneId` ist der
      // React-Key der Zelle — ein neues Objekt wäre verkraftbar, eine neue
      // Id würde den Teilbaum remounten und die PTYs killen.
      const start = onePaneTwoTabs();
      const paneBefore = start.slots[0] as Pane;
      const next = movePaneToEmptySlot(start, "pane-0", 2);

      expect(next.slots[2]).toBe(paneBefore);
      expect(next.slots[0]).toBeNull();
      expect(terminalTabs(next.slots[2] as Pane).map((tab) => tab.tabId)).toEqual([
        "tab-0",
        "tab-0b",
      ]);
    });

    it("fokussiert die gezogene Pane (gerichteter Zug, anders als der symmetrische Tausch)", () => {
      const start = assignProjectToSlot(
        onePaneTwoTabs(),
        1,
        "/repo/b",
        "pane-1",
        "tab-1",
      );
      // pane-1 ist nach der Zuweisung fokussiert — der Zug von pane-0 holt
      // den Fokus zu sich.
      expect(start.focusedPaneId).toBe("pane-1");
      const next = movePaneToEmptySlot(start, "pane-0", 2);
      expect(next.focusedPaneId).toBe("pane-0");
    });

    it("lässt maximizedPaneId unberührt (die Pane existiert weiter)", () => {
      const start = enterFocusMode(onePaneTwoTabs(), "pane-0");
      const next = movePaneToEmptySlot(start, "pane-0", 3);
      expect(next.maximizedPaneId).toBe("pane-0");
    });

    it("ist ein No-Op auf einen BELEGTEN Slot (Wettlauf mit einer parallelen Zuweisung)", () => {
      const start = assignProjectToSlot(
        onePaneTwoTabs(),
        1,
        "/repo/b",
        "pane-1",
        "tab-1",
      );
      expect(movePaneToEmptySlot(start, "pane-0", 1)).toBe(start);
      // Auch der eigene Slot ist "belegt" — von der Pane selbst.
      expect(movePaneToEmptySlot(start, "pane-0", 0)).toBe(start);
    });

    it("ist ein No-Op bei Index außerhalb des Templates und unbekannter Pane", () => {
      const start = onePaneTwoTabs();
      expect(movePaneToEmptySlot(start, "pane-0", -1)).toBe(start);
      expect(movePaneToEmptySlot(start, "pane-0", 4)).toBe(start);
      expect(movePaneToEmptySlot(start, "gibt-es-nicht", 1)).toBe(start);
    });
  });

  describe("swapPanes (Ticket 20)", () => {
    function quadWithTwoPanes(): GridState {
      return assignProjectToSlot(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        3,
        "/repo/b",
        "pane-1",
        "tab-1",
      );
    }

    it("tauscht zwei belegte Slots und lässt Template/Slot-Zahl unberührt", () => {
      const withTwo = quadWithTwoPanes();
      const next = swapPanes(withTwo, 0, 3);
      expect((next.slots[0] as Pane).paneId).toBe("pane-1");
      expect((next.slots[3] as Pane).paneId).toBe("pane-0");
      expect(next.slots[1]).toBeNull();
      expect(next.slots[2]).toBeNull();
      expect(next.template).toBe(withTwo.template);
      expect(next.slots).toHaveLength(withTwo.slots.length);
    });

    it("bewegt die Panes als identische Objekte (Tabs/PTY-Zuordnung unverändert)", () => {
      const withTwo = openFileTab(
        quadWithTwoPanes(),
        "pane-0",
        "file-0",
        "README.md",
      );
      const next = swapPanes(withTwo, 0, 3);
      // Referenzgleich: der Tausch schreibt Panes um, er baut sie nicht neu —
      // sonst wären Terminal-Tabs (und damit die PTY-Zuordnung) neue Objekte.
      expect(next.slots[0]).toBe(withTwo.slots[3]);
      expect(next.slots[3]).toBe(withTwo.slots[0]);
    });

    it("clears focus when deleting the final File-Tab removes its Pane", () => {
      const withFileOnly = moveTerminalTab(
        openFileTab(
          assignProjectToSlot(
            assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
            1,
            "/repo/a",
            "pane-1",
            "tab-1",
          ),
          "pane-0",
          "file-0",
          "README.md",
        ),
        "pane-0",
        "tab-0",
        "pane-1",
      );

      const next = closeFileTabsUnder(
        focusPane(withFileOnly, "pane-0"),
        "/repo/a",
        "README.md",
      );

      expect(next.slots[0]).toBeNull();
      expect(next.focusedPaneId).toBe("pane-1");
    });

    it("lässt Fokus und Fokus-Modus an der Pane, nicht an der Position", () => {
      const maximized = enterFocusMode(quadWithTwoPanes(), "pane-1");
      const next = swapPanes(maximized, 0, 3);
      expect(next.focusedPaneId).toBe("pane-1");
      expect(next.maximizedPaneId).toBe("pane-1");
    });

    it("ist ein No-Op (identische Referenz) beim Tausch einer Pane mit sich selbst", () => {
      const withTwo = quadWithTwoPanes();
      expect(swapPanes(withTwo, 0, 0)).toBe(withTwo);
    });

    it("ist ein No-Op bei ungültigen Indizes", () => {
      const withTwo = quadWithTwoPanes();
      expect(swapPanes(withTwo, -1, 3)).toBe(withTwo);
      expect(swapPanes(withTwo, 0, 99)).toBe(withTwo);
    });

    it("ist ein No-Op, wenn einer der beiden Slots leer ist (leerer Slot = Picker-Fluss)", () => {
      const withTwo = quadWithTwoPanes();
      expect(swapPanes(withTwo, 0, 1)).toBe(withTwo);
      expect(swapPanes(withTwo, 1, 3)).toBe(withTwo);
      expect(swapPanes(withTwo, 1, 2)).toBe(withTwo);
    });
  });

  describe("Fokus-Modus (Ticket 19)", () => {
    function quadWithTwoPanes(): GridState {
      return assignProjectToSlot(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        1,
        "/repo/b",
        "pane-1",
        "tab-1",
      );
    }

    it("enterFocusMode setzt maximizedPaneId und fokussiert dieselbe Pane", () => {
      const withTwo = quadWithTwoPanes();
      const next = enterFocusMode(withTwo, "pane-1");
      expect(next.maximizedPaneId).toBe("pane-1");
      expect(next.focusedPaneId).toBe("pane-1");
    });

    it("enterFocusMode ist ein No-Op bei unbekannter paneId oder bereits maximierter Pane", () => {
      const withTwo = quadWithTwoPanes();
      expect(enterFocusMode(withTwo, "does-not-exist")).toBe(withTwo);
      const maximized = enterFocusMode(withTwo, "pane-0");
      expect(enterFocusMode(maximized, "pane-0")).toBe(maximized);
    });

    it("exitFocusMode räumt maximizedPaneId, lässt Slots/Fokus unangetastet", () => {
      const maximized = enterFocusMode(quadWithTwoPanes(), "pane-1");
      const next = exitFocusMode(maximized);
      expect(next.maximizedPaneId).toBeNull();
      expect(next.focusedPaneId).toBe("pane-1");
      expect(next.slots).toEqual(maximized.slots);
    });

    it("exitFocusMode ist ein No-Op, wenn kein Fokus-Modus aktiv ist", () => {
      const withTwo = quadWithTwoPanes();
      expect(exitFocusMode(withTwo)).toBe(withTwo);
    });

    it("focusModeSelectSlot wechselt im Fokus-Modus direkt zur Pane im Ziel-Slot", () => {
      const maximized = enterFocusMode(quadWithTwoPanes(), "pane-0");
      const next = focusModeSelectSlot(maximized, 1);
      expect(next.maximizedPaneId).toBe("pane-1");
      expect(next.focusedPaneId).toBe("pane-1");
    });

    it("focusModeSelectSlot ist ein No-Op außerhalb des Fokus-Modus, bei leerem Slot oder unbekanntem Index", () => {
      const withTwo = quadWithTwoPanes();
      expect(focusModeSelectSlot(withTwo, 1)).toBe(withTwo);

      const maximized = enterFocusMode(withTwo, "pane-0");
      expect(focusModeSelectSlot(maximized, 2)).toBe(maximized);
      expect(focusModeSelectSlot(maximized, 99)).toBe(maximized);
    });

    it("closePane räumt maximizedPaneId, wenn die maximierte Pane geschlossen wird", () => {
      const maximized = enterFocusMode(quadWithTwoPanes(), "pane-1");
      const next = closePane(maximized, "pane-1");
      expect(next.maximizedPaneId).toBeNull();
    });

    it("closePane lässt maximizedPaneId unangetastet, wenn eine ANDERE Pane geschlossen wird", () => {
      const maximized = enterFocusMode(quadWithTwoPanes(), "pane-1");
      const next = closePane(maximized, "pane-0");
      expect(next.maximizedPaneId).toBe("pane-1");
    });

    it("switchTemplate erhält maximizedPaneId, solange die Pane im Ziel-Template weiter aktiv ist", () => {
      const maximized = enterFocusMode(quadWithTwoPanes(), "pane-1");
      const next = switchTemplate(maximized, "split");
      expect(next.template).toBe("split");
      expect(next.maximizedPaneId).toBe("pane-1");
    });
  });

  describe("nextPaneId (Titelleisten-Pfeile, pane-navigation-titlebar/01+02)", () => {
    function quadWithThreePanes(): GridState {
      return assignProjectToSlot(
        assignProjectToSlot(
          assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
          1,
          "/repo/b",
          "pane-1",
          "tab-1",
        ),
        2,
        "/repo/c",
        "pane-2",
        "tab-2",
      );
    }

    it("liefert die nächste Pane in Slot-Reihenfolge", () => {
      const panes = activePanes(quadWithThreePanes());
      expect(nextPaneId(panes, "pane-0", "next")).toBe("pane-1");
      expect(nextPaneId(panes, "pane-1", "next")).toBe("pane-2");
    });

    it("wrapt von der letzten zur ersten Pane", () => {
      const panes = activePanes(quadWithThreePanes());
      expect(nextPaneId(panes, "pane-2", "next")).toBe("pane-0");
    });

    it("liefert die vorherige Pane in Slot-Reihenfolge", () => {
      const panes = activePanes(quadWithThreePanes());
      expect(nextPaneId(panes, "pane-2", "previous")).toBe("pane-1");
      expect(nextPaneId(panes, "pane-1", "previous")).toBe("pane-0");
    });

    it("wrapt von der ersten zur letzten Pane", () => {
      const panes = activePanes(quadWithThreePanes());
      expect(nextPaneId(panes, "pane-0", "previous")).toBe("pane-2");
    });

    it("liefert bei genau einer Pane immer dieselbe Pane zurück", () => {
      const single = assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0");
      const panes = activePanes(single);
      expect(nextPaneId(panes, "pane-0", "next")).toBe("pane-0");
      expect(nextPaneId(panes, "pane-0", "previous")).toBe("pane-0");
    });

    it("liefert null, wenn keine Pane belegt ist", () => {
      expect(nextPaneId(activePanes(INITIAL_GRID_STATE), null, "next")).toBeNull();
      expect(nextPaneId(activePanes(INITIAL_GRID_STATE), null, "previous")).toBeNull();
    });

    it("startet bei unbekannter/fehlender currentId am Anfang (next) bzw. Ende (previous) der Liste", () => {
      const panes = activePanes(quadWithThreePanes());
      expect(nextPaneId(panes, null, "next")).toBe("pane-0");
      expect(nextPaneId(panes, "does-not-exist", "next")).toBe("pane-0");
      expect(nextPaneId(panes, null, "previous")).toBe("pane-2");
      expect(nextPaneId(panes, "does-not-exist", "previous")).toBe("pane-2");
    });
  });

  describe("Schnittkanten-Splitter (Ticket 21)", () => {
    it("trackShape kennt Spalten/Zeilen jedes der 7 Templates", () => {
      expect(trackShape("single")).toEqual({ columns: 1, rows: 1 });
      expect(trackShape("split")).toEqual({ columns: 2, rows: 1 });
      expect(trackShape("row-3")).toEqual({ columns: 3, rows: 1 });
      expect(trackShape("row-4")).toEqual({ columns: 4, rows: 1 });
      expect(trackShape("quad")).toEqual({ columns: 2, rows: 2 });
      expect(trackShape("two-over-one")).toEqual({ columns: 2, rows: 2 });
      expect(trackShape("one-over-two")).toEqual({ columns: 2, rows: 2 });
    });

    it("startet mit leeren splitRatios (Template-Default)", () => {
      expect(INITIAL_GRID_STATE.splitRatios).toEqual([]);
    });

    it("setSplitRatios schreibt die Anteile, sonst unverändert", () => {
      const next = setSplitRatios(INITIAL_GRID_STATE, [0.3, 0.7]);
      expect(next.splitRatios).toEqual([0.3, 0.7]);
      expect(next.template).toBe(INITIAL_GRID_STATE.template);
      expect(next.slots).toBe(INITIAL_GRID_STATE.slots);
    });

    it("switchTemplate setzt splitRatios auf leer zurück (neue Track-Form)", () => {
      const withRatios = setSplitRatios(INITIAL_GRID_STATE, [0.4, 0.6, 0.5, 0.5]);
      const next = switchTemplate(withRatios, "split");
      expect(next.splitRatios).toEqual([]);
    });

    it("ein No-Op-Template-Wechsel lässt splitRatios unangetastet", () => {
      const withRatios = setSplitRatios(INITIAL_GRID_STATE, [0.4, 0.6, 0.5, 0.5]);
      expect(switchTemplate(withRatios, "quad")).toBe(withRatios);
    });

    it("ein geblockter Template-Wechsel lässt splitRatios unangetastet", () => {
      const threeActive = assignProjectToSlot(
        assignProjectToSlot(
          assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
          1,
          "/repo/b",
          "pane-1",
          "tab-1",
        ),
        2,
        "/repo/c",
        "pane-2",
        "tab-2",
      );
      const withRatios = setSplitRatios(threeActive, [0.4, 0.6, 0.5, 0.5]);
      expect(switchTemplate(withRatios, "split")).toBe(withRatios);
    });
  });
});
