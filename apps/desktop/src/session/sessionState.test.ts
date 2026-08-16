import { describe, expect, it } from "vitest";
import {
  INITIAL_GRID_STATE,
  assignProjectToSlot,
  openTerminalTab,
  setSplitRatios,
  switchTemplate,
  switchToFileTab,
  switchToTerminalTab,
} from "../grid/gridState";
import {
  RECENT_PROJECTS_MAX,
  buildWindowState,
  restoredSlots,
  restoredSplitRatios,
  restoredTemplate,
  withRecentProject,
  withoutRecentProject,
  type SessionState,
} from "./sessionState";

const LABEL = "main";

describe("buildWindowState", () => {
  it("baut leere Slots aus einem leeren Grid", () => {
    const state = buildWindowState(LABEL, INITIAL_GRID_STATE, {});

    expect(state).toEqual({
      label: LABEL,
      template: "quad",
      slots: [null, null, null, null],
      split_ratios: [],
      maximized_pane_id: null,
    });
  });

  it("trägt Projektpfad und Template einer belegten Pane als einzelnen Terminal-Tab ein", () => {
    const grid = assignProjectToSlot(
      INITIAL_GRID_STATE,
      2,
      "/repo/storefront",
      "pane-1",
      "tab-1",
    );

    const state = buildWindowState(LABEL, grid, {});

    expect(state.slots[2]).toEqual({
      project_path: "/repo/storefront",
      terminal_tabs: [{ title: null }],
      active_tab: { kind: "terminal", index: 0 },
      file_tab: null,
      adapter_id: null,
    });
  });

  it("trägt mehrere Terminal-Tabs samt dem Index des aktiven ein", () => {
    const withTwoTabs = openTerminalTab(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/storefront", "pane-1", "tab-1"),
      "pane-1",
      "tab-2",
    );
    const backToFirst = switchToTerminalTab(withTwoTabs, "pane-1", "tab-1");

    const state = buildWindowState(LABEL, backToFirst, {});

    expect(state.slots[0]).toEqual({
      project_path: "/repo/storefront",
      terminal_tabs: [{ title: null }, { title: null }],
      active_tab: { kind: "terminal", index: 0 },
      file_tab: null,
      adapter_id: null,
    });
  });

  it("trägt die letzte ausgewählte Datei der Pane als aktiven File-Tab ein, wenn der File-Tab auch aktiv ist", () => {
    const grid = switchToFileTab(
      assignProjectToSlot(INITIAL_GRID_STATE, 0, "/repo/storefront", "pane-1", "tab-1"),
      "pane-1",
    );

    const state = buildWindowState(LABEL, grid, { "pane-1": "src/App.tsx" });

    expect(state.slots[0]).toMatchObject({
      project_path: "/repo/storefront",
      active_tab: { kind: "file" },
      file_tab: { path: "src/App.tsx" },
    });
  });

  it("bleibt beim Terminal-Tab, wenn eine Datei ausgewählt, aber nicht als aktive Ansicht gewählt ist", () => {
    // Nicht via switchToFileTab: die Pane zeigt gerade ihr Terminal, obwohl
    // im Explorer bereits eine Datei markiert ist — genau der Zustand, den
    // `PaneGrid.tsx`s eigener `showingFile`-Abgleich für den Editor-Zustand
    // spiegelt (dort: "Datei tatsächlich offen", hier: "als Ansicht aktiv").
    const grid = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/storefront",
      "pane-1",
      "tab-1",
    );

    const state = buildWindowState(LABEL, grid, { "pane-1": "src/App.tsx" });

    expect(state.slots[0]).toMatchObject({
      active_tab: { kind: "terminal", index: 0 },
      file_tab: { path: "src/App.tsx" },
    });
  });

  it("ignoriert eine Auswahl, die zu keiner belegten Pane gehört", () => {
    const state = buildWindowState(LABEL, INITIAL_GRID_STATE, {
      "verwaiste-pane": "irgendwas.txt",
    });

    expect(state.slots).toEqual([null, null, null, null]);
  });

  it("spiegelt einen Template-Wechsel", () => {
    const grid = switchTemplate(INITIAL_GRID_STATE, "split");

    expect(buildWindowState(LABEL, grid, {}).template).toBe("split");
  });

  it("trägt das native Fensterlabel ein", () => {
    const state = buildWindowState("main-2", INITIAL_GRID_STATE, {});

    expect(state.label).toBe("main-2");
  });

  it("trägt die maximierte Pane ein (Fokus-Modus)", () => {
    const grid = { ...INITIAL_GRID_STATE, maximizedPaneId: "pane-1" };

    expect(buildWindowState(LABEL, grid, {}).maximized_pane_id).toBe("pane-1");
  });

  it("trägt verschobene Schnittkanten-Verhältnisse ein (Ticket 21)", () => {
    const grid = setSplitRatios(INITIAL_GRID_STATE, [0.3, 0.7, 0.5, 0.5]);

    expect(buildWindowState(LABEL, grid, {}).split_ratios).toEqual([
      0.3, 0.7, 0.5, 0.5,
    ]);
  });
});

describe("restoredTemplate", () => {
  it("übernimmt ein bekanntes Template des eigenen Fensters", () => {
    const session: SessionState = {
      windows: [{ label: LABEL, template: "row-4", slots: [] }],
    };

    expect(restoredTemplate(session, LABEL)).toBe("row-4");
  });

  it("fällt bei einem unbekannten Template auf den Default zurück", () => {
    const session: SessionState = {
      windows: [{ label: LABEL, template: "hexa-grid", slots: [] }],
    };

    expect(restoredTemplate(session, LABEL)).toBe("quad");
  });

  it("fällt ohne jedes Fenster auf den Default zurück", () => {
    const session: SessionState = { windows: [] };

    expect(restoredTemplate(session, LABEL)).toBe("quad");
  });

  it("fällt zurück, wenn kein Fenster mit diesem Label existiert", () => {
    const session: SessionState = {
      windows: [{ label: "main-2", template: "split", slots: [] }],
    };

    expect(restoredTemplate(session, LABEL)).toBe("quad");
  });
});

describe("restoredSlots", () => {
  it("liefert die Slots des eigenen Fensters", () => {
    const session: SessionState = {
      windows: [
        {
          label: LABEL,
          template: "single",
          slots: [
            {
              project_path: "/repo/storefront",
              terminal_tabs: [{}],
              active_tab: { kind: "terminal", index: 0 },
            },
          ],
        },
      ],
    };

    expect(restoredSlots(session, LABEL)).toEqual(session.windows[0]?.slots);
  });

  it("liefert eine leere Liste ohne jedes Fenster", () => {
    expect(restoredSlots({ windows: [] }, LABEL)).toEqual([]);
  });

  it("liefert eine leere Liste, wenn kein Fenster mit diesem Label existiert", () => {
    const session: SessionState = {
      windows: [{ label: "main-2", template: "single", slots: [] }],
    };

    expect(restoredSlots(session, LABEL)).toEqual([]);
  });
});

describe("restoredSplitRatios", () => {
  it("liefert die Schnittkanten-Verhältnisse des eigenen Fensters", () => {
    const session: SessionState = {
      windows: [
        { label: LABEL, template: "split", slots: [], split_ratios: [0.3, 0.7] },
      ],
    };

    expect(restoredSplitRatios(session, LABEL)).toEqual([0.3, 0.7]);
  });

  it("liefert eine leere Liste ohne gespeicherte Verhältnisse", () => {
    const session: SessionState = {
      windows: [{ label: LABEL, template: "split", slots: [] }],
    };

    expect(restoredSplitRatios(session, LABEL)).toEqual([]);
  });

  it("liefert eine leere Liste ohne jedes Fenster", () => {
    expect(restoredSplitRatios({ windows: [] }, LABEL)).toEqual([]);
  });

  it("liefert eine leere Liste, wenn kein Fenster mit diesem Label existiert", () => {
    const session: SessionState = {
      windows: [
        { label: "main-2", template: "split", slots: [], split_ratios: [0.3, 0.7] },
      ],
    };

    expect(restoredSplitRatios(session, LABEL)).toEqual([]);
  });
});

// Recent-Projects (Ticket 22): App-weite Liste, "zuletzt geöffnet zuerst",
// max. 8 Einträge, kein Pinning. Reine Funktionen, damit App.tsx nur noch
// verdrahtet, nicht selbst die Sortier-/Kappungslogik trägt.
describe("withRecentProject", () => {
  it("stellt einen neuen Pfad an den Anfang", () => {
    expect(withRecentProject(["/repo/b"], "/repo/a")).toEqual([
      "/repo/a",
      "/repo/b",
    ]);
  });

  it("verschiebt einen bereits vorhandenen Pfad an den Anfang, statt ihn zu duplizieren", () => {
    expect(withRecentProject(["/repo/a", "/repo/b"], "/repo/b")).toEqual([
      "/repo/b",
      "/repo/a",
    ]);
  });

  it(`kappt bei ${RECENT_PROJECTS_MAX} Einträgen`, () => {
    const full = Array.from({ length: RECENT_PROJECTS_MAX }, (_, i) => `/repo/${i}`);
    const next = withRecentProject(full, "/repo/new");

    expect(next).toHaveLength(RECENT_PROJECTS_MAX);
    expect(next[0]).toBe("/repo/new");
    expect(next).not.toContain(`/repo/${RECENT_PROJECTS_MAX - 1}`);
  });
});

describe("withoutRecentProject", () => {
  it("entfernt genau den angegebenen Pfad", () => {
    expect(
      withoutRecentProject(["/repo/a", "/repo/b"], "/repo/a"),
    ).toEqual(["/repo/b"]);
  });

  it("ist ein No-Op, wenn der Pfad nicht in der Liste steht", () => {
    expect(withoutRecentProject(["/repo/a"], "/repo/z")).toEqual([
      "/repo/a",
    ]);
  });
});
