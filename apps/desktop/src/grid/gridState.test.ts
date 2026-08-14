import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE,
  GRID_TEMPLATES,
  INITIAL_GRID_STATE,
  activePanes,
  assignProjectToSlot,
  closePane,
  closeTerminalTab,
  enterFocusMode,
  exitFocusMode,
  focusModeSelectSlot,
  focusPane,
  focusedProjectPath,
  moveTerminalTab,
  openTerminalTab,
  renameTerminalTab,
  swapPanes,
  switchTemplate,
  switchToFileTab,
  switchToTerminalTab,
  templateSwitchBlockReason,
  type GridState,
  type Pane,
} from "./gridState";

describe("gridState", () => {
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
        terminalTabs: [{ tabId: "tab-1", label: null }],
        activeTerminalTabId: "tab-1",
        showingFile: false,
      },
      null,
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
      expect(pane.terminalTabs).toEqual([
        { tabId: "tab-0", label: null },
        { tabId: "tab-1", label: null },
      ]);
      expect(pane.activeTerminalTabId).toBe("tab-1");
    });

    it("verlässt dabei einen gerade sichtbaren File-Tab", () => {
      const pane = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "tab-0",
      );
      const withFile = switchToFileTab(pane, "pane-0");
      const next = openTerminalTab(withFile, "pane-0", "tab-1");
      expect((next.slots[0] as Pane).showingFile).toBe(false);
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
      expect((next.slots[0] as Pane).terminalTabs).toEqual([{ tabId: "tab-1", label: null }]);
    });

    it("übernimmt der Vorgänger, wenn der aktive Tab geschlossen wird", () => {
      const withThree = openTerminalTab(twoTabPane(), "pane-0", "tab-2");
      const next = closeTerminalTab(withThree, "pane-0", "tab-2");
      expect((next.slots[0] as Pane).activeTerminalTabId).toBe("tab-1");
    });

    it("übernimmt der Nachfolger, wenn Tab 0 aktiv war und geschlossen wird", () => {
      const withTwo = twoTabPane();
      const backToFirst = switchToTerminalTab(withTwo, "pane-0", "tab-0");
      const next = closeTerminalTab(backToFirst, "pane-0", "tab-0");
      expect((next.slots[0] as Pane).activeTerminalTabId).toBe("tab-1");
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
      expect((next.slots[0] as Pane).activeTerminalTabId).toBe("tab-0");
      expect((next.slots[0] as Pane).showingFile).toBe(false);
    });

    it("wechselt zum File-Tab, ohne den aktiven Terminal-Tab zu verändern", () => {
      const withOne = assignProjectToSlot(
        INITIAL_GRID_STATE,
        0,
        "/repo/a",
        "pane-0",
        "tab-0",
      );
      const next = switchToFileTab(withOne, "pane-0");
      const pane = next.slots[0] as Pane;
      expect(pane.showingFile).toBe(true);
      expect(pane.activeTerminalTabId).toBe("tab-0");
    });

    it("switchToFileTab ist ein No-Op, wenn der File-Tab bereits sichtbar ist", () => {
      const withFile = switchToFileTab(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0", "tab-0"),
        "pane-0",
      );
      expect(switchToFileTab(withFile, "pane-0")).toBe(withFile);
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
      expect(target.terminalTabs.map((tab) => tab.tabId)).toEqual([
        "tab-1",
        "tab-0b",
      ]);
      expect(target.activeTerminalTabId).toBe("tab-0b");
      expect(target.showingFile).toBe(false);
      expect(next.focusedPaneId).toBe("pane-1");
    });

    it("lässt die Quell-Pane mit ihrem verbleibenden Tab aktiv zurück", () => {
      // "tab-0b" war nach `openTerminalTab` der aktive Tab der Quelle — nach
      // dem Wegziehen muss dort ein anderer übernehmen, sonst zeigte die
      // Pane auf einen Tab, den sie nicht mehr hat.
      const start = twoPanesSameProject();
      const next = moveTerminalTab(start, "pane-0", "tab-0b", "pane-1");

      const source = next.slots[0] as Pane;
      expect(source.terminalTabs.map((tab) => tab.tabId)).toEqual(["tab-0"]);
      expect(source.activeTerminalTabId).toBe("tab-0");
    });

    it("lässt den aktiven Tab der Quelle unangetastet, wenn ein INAKTIVER wegzieht", () => {
      const start = switchToTerminalTab(twoPanesSameProject(), "pane-0", "tab-0");
      const next = moveTerminalTab(start, "pane-0", "tab-0b", "pane-1");
      expect((next.slots[0] as Pane).activeTerminalTabId).toBe("tab-0");
    });

    it("verschiebt den Tab als identisches Objekt (Name/PTY-Zuordnung bleiben)", () => {
      const start = renameTerminalTab(
        twoPanesSameProject(),
        "pane-0",
        "tab-0b",
        "Build",
      );
      const movedBefore = (start.slots[0] as Pane).terminalTabs[1];
      const next = moveTerminalTab(start, "pane-0", "tab-0b", "pane-1");
      expect((next.slots[1] as Pane).terminalTabs[1]).toBe(movedBefore);
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
      expect(target.terminalTabs.map((tab) => tab.tabId)).toEqual([
        "tab-1",
        "tab-0",
      ]);
      expect(target.activeTerminalTabId).toBe("tab-0");
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
      expect(target.terminalTabs.map((tab) => tab.tabId)).toEqual([
        "tab-1",
        "tab-0b",
        "tab-1b",
      ]);
      expect(target.activeTerminalTabId).toBe("tab-0b");
    });

    it("sortiert innerhalb DERSELBEN Pane um und macht den gezogenen Tab aktiv", () => {
      // Drei Tabs in pane-0: [tab-0, tab-0b, tab-0c]. tab-0 an Slot 2
      // (zwischen tab-0b und tab-0c, vor dem Herauslösen gezählt) heißt
      // End-Position 1.
      const start = openTerminalTab(twoPanesSameProject(), "pane-0", "tab-0c");
      const next = moveTerminalTab(start, "pane-0", "tab-0", "pane-0", 2);

      const pane = next.slots[0] as Pane;
      expect(pane.terminalTabs.map((tab) => tab.tabId)).toEqual([
        "tab-0b",
        "tab-0",
        "tab-0c",
      ]);
      expect(pane.activeTerminalTabId).toBe("tab-0");
      expect(next.focusedPaneId).toBe("pane-0");
    });

    it("sortiert nach vorn: ein Slot VOR der eigenen Position zählt unverändert", () => {
      const start = openTerminalTab(twoPanesSameProject(), "pane-0", "tab-0c");
      const next = moveTerminalTab(start, "pane-0", "tab-0c", "pane-0", 0);
      expect(
        (next.slots[0] as Pane).terminalTabs.map((tab) => tab.tabId),
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
      const withTwo = quadWithTwoPanes();
      const next = swapPanes(withTwo, 0, 3);
      // Referenzgleich: der Tausch schreibt Panes um, er baut sie nicht neu —
      // sonst wären Terminal-Tabs (und damit die PTY-Zuordnung) neue Objekte.
      expect(next.slots[0]).toBe(withTwo.slots[3]);
      expect(next.slots[3]).toBe(withTwo.slots[0]);
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
});
