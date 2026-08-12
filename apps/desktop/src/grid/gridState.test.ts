import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE,
  GRID_TEMPLATES,
  INITIAL_GRID_STATE,
  activePanes,
  assignProjectToSlot,
  closePane,
  focusPane,
  focusedProjectPath,
  switchTemplate,
  templateSwitchBlockReason,
  type GridState,
} from "./gridState";

describe("gridState", () => {
  it("startet mit Quad und vier leeren Slots", () => {
    expect(INITIAL_GRID_STATE.template).toBe(DEFAULT_TEMPLATE);
    expect(INITIAL_GRID_STATE.template).toBe("quad");
    expect(INITIAL_GRID_STATE.slots).toEqual([null, null, null, null]);
    expect(INITIAL_GRID_STATE.focusedPaneId).toBeNull();
  });

  it.each(GRID_TEMPLATES.map((t) => [t.id, t.slotCount] as const))(
    "Template %s hat %i Slot(s)",
    (id, count) => {
      const state = switchTemplate(INITIAL_GRID_STATE, id);
      expect(state.slots).toHaveLength(count);
    },
  );

  it("Zuweisung füllt genau den adressierten Slot", () => {
    const next = assignProjectToSlot(
      INITIAL_GRID_STATE,
      2,
      "/repo/storefront",
      "pane-1",
    );
    expect(next.slots).toEqual([
      null,
      null,
      { paneId: "pane-1", projectPath: "/repo/storefront" },
      null,
    ]);
  });

  it("erlaubt dasselbe Projekt in zwei Slots ohne Dedup", () => {
    const step1 = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/storefront",
      "pane-1",
    );
    const step2 = assignProjectToSlot(
      step1,
      1,
      "/repo/storefront",
      "pane-2",
    );
    expect(activePanes(step2)).toEqual([
      { paneId: "pane-1", projectPath: "/repo/storefront" },
      { paneId: "pane-2", projectPath: "/repo/storefront" },
    ]);
  });

  it("ersetzt bei Neuzuweisung eines belegten Slots mit neuer paneId", () => {
    const step1 = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/storefront",
      "pane-1",
    );
    const step2 = assignProjectToSlot(step1, 0, "/repo/other", "pane-2");
    expect(step2.slots[0]).toEqual({
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
    );
    const grown = switchTemplate(withPane, "row-4");
    expect(grown.slots).toEqual([
      null,
      { paneId: "pane-1", projectPath: "/repo/storefront" },
      null,
      null,
    ]);
  });

  it("kompaktiert beim passenden Schrumpfen der Reihe nach (nicht per Index)", () => {
    const quad = INITIAL_GRID_STATE;
    const withPanes = assignProjectToSlot(
      assignProjectToSlot(quad, 0, "/repo/a", "pane-0"),
      3,
      "/repo/d",
      "pane-3",
    );
    const shrunk = switchTemplate(withPanes, "split");
    expect(shrunk.slots).toEqual([
      { paneId: "pane-0", projectPath: "/repo/a" },
      { paneId: "pane-3", projectPath: "/repo/d" },
    ]);
  });

  it("blockiert Schrumpfen, das nicht passt, und liefert dieselbe Referenz", () => {
    const threeActive = assignProjectToSlot(
      assignProjectToSlot(
        assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0"),
        1,
        "/repo/b",
        "pane-1",
      ),
      2,
      "/repo/c",
      "pane-2",
    );
    const reason = templateSwitchBlockReason(threeActive, "split");
    expect(reason).toContain("3");
    expect(reason).toContain("2");

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
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0"),
      1,
      "/repo/b",
      "pane-1",
    );
    const next = closePane(withTwo, "pane-0");
    expect(next.slots[0]).toBeNull();
    expect(next.slots[1]).toEqual({ paneId: "pane-1", projectPath: "/repo/b" });
  });

  it("verschiebt den Fokus beim Schließen der fokussierten Pane auf die erste verbleibende", () => {
    const withTwo = assignProjectToSlot(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0"),
      1,
      "/repo/b",
      "pane-1",
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
    );
    expect(closePane(withOne, "does-not-exist")).toBe(withOne);
  });

  it("liefert den Projektpfad der fokussierten Pane", () => {
    const withOne = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/a",
      "pane-0",
    );
    expect(focusedProjectPath(withOne)).toBe("/repo/a");
    expect(focusedProjectPath(INITIAL_GRID_STATE)).toBeNull();
  });

  it("wechselt den Fokus auf eine andere belegte Pane", () => {
    const withTwo = assignProjectToSlot(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/a", "pane-0"),
      1,
      "/repo/b",
      "pane-1",
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
    );
    expect(focusPane(withOne, "pane-0")).toBe(withOne);
  });

  it("lässt den State bei unbekannter paneId unverändert", () => {
    const withOne = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/a",
      "pane-0",
    );
    expect(focusPane(withOne, "does-not-exist")).toBe(withOne);
  });
});
