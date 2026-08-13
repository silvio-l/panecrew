import { describe, expect, it } from "vitest";
import {
  INITIAL_GRID_STATE,
  assignProjectToSlot,
  openTerminalTab,
  switchTemplate,
  switchToFileTab,
  switchToTerminalTab,
} from "../grid/gridState";
import { buildSessionState, restoredSlots, restoredTemplate, type SessionState } from "./sessionState";

const EXPLORER_WIDTH = 224;

describe("buildSessionState", () => {
  it("baut leere Slots aus einem leeren Grid", () => {
    const state = buildSessionState(INITIAL_GRID_STATE, {}, {}, EXPLORER_WIDTH);

    expect(state).toEqual({
      windows: [
        {
          template: "quad",
          slots: [null, null, null, null],
          split_ratios: [],
          maximized_pane_id: null,
        },
      ],
      expanded_folders: {},
      explorer_width: EXPLORER_WIDTH,
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

    const state = buildSessionState(grid, {}, {}, EXPLORER_WIDTH);

    expect(state.windows[0]?.slots[2]).toEqual({
      project_path: "/repo/storefront",
      terminal_tabs: [{}],
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

    const state = buildSessionState(backToFirst, {}, {}, EXPLORER_WIDTH);

    expect(state.windows[0]?.slots[0]).toEqual({
      project_path: "/repo/storefront",
      terminal_tabs: [{}, {}],
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

    const state = buildSessionState(grid, { "pane-1": "src/App.tsx" }, {}, EXPLORER_WIDTH);

    expect(state.windows[0]?.slots[0]).toMatchObject({
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

    const state = buildSessionState(grid, { "pane-1": "src/App.tsx" }, {}, EXPLORER_WIDTH);

    expect(state.windows[0]?.slots[0]).toMatchObject({
      active_tab: { kind: "terminal", index: 0 },
      file_tab: { path: "src/App.tsx" },
    });
  });

  it("ignoriert eine Auswahl, die zu keiner belegten Pane gehört", () => {
    const state = buildSessionState(
      INITIAL_GRID_STATE,
      { "verwaiste-pane": "irgendwas.txt" },
      {},
      EXPLORER_WIDTH,
    );

    expect(state.windows[0]?.slots).toEqual([null, null, null, null]);
  });

  it("spiegelt einen Template-Wechsel im ersten Fenster", () => {
    const grid = switchTemplate(INITIAL_GRID_STATE, "split");

    expect(buildSessionState(grid, {}, {}, EXPLORER_WIDTH).windows[0]?.template).toBe("split");
  });

  it("trägt die aufgeklappten Ordner projektpfad-geschlüsselt ein", () => {
    const state = buildSessionState(
      INITIAL_GRID_STATE,
      {},
      { "/repo/storefront": ["src", "src/core"] },
      EXPLORER_WIDTH,
    );

    expect(state.expanded_folders).toEqual({
      "/repo/storefront": ["src", "src/core"],
    });
  });

  it("trägt die Explorer-Breite ein", () => {
    const state = buildSessionState(INITIAL_GRID_STATE, {}, {}, 320);

    expect(state.explorer_width).toBe(320);
  });
});

describe("restoredTemplate", () => {
  it("übernimmt ein bekanntes Template des ersten Fensters", () => {
    const session: SessionState = { windows: [{ template: "row-4", slots: [] }] };

    expect(restoredTemplate(session)).toBe("row-4");
  });

  it("fällt bei einem unbekannten Template auf den Default zurück", () => {
    const session: SessionState = { windows: [{ template: "hexa-grid", slots: [] }] };

    expect(restoredTemplate(session)).toBe("quad");
  });

  it("fällt ohne jedes Fenster auf den Default zurück", () => {
    const session: SessionState = { windows: [] };

    expect(restoredTemplate(session)).toBe("quad");
  });
});

describe("restoredSlots", () => {
  it("liefert die Slots des ersten Fensters", () => {
    const session: SessionState = {
      windows: [
        {
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

    expect(restoredSlots(session)).toEqual(session.windows[0]?.slots);
  });

  it("liefert eine leere Liste ohne jedes Fenster", () => {
    expect(restoredSlots({ windows: [] })).toEqual([]);
  });
});
