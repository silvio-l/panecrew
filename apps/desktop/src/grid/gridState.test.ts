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
  openTerminalTab,
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
        terminalTabs: [{ tabId: "tab-1" }],
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
      expect(pane.terminalTabs).toEqual([{ tabId: "tab-0" }, { tabId: "tab-1" }]);
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
      expect((next.slots[0] as Pane).terminalTabs).toEqual([{ tabId: "tab-1" }]);
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
