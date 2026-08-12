import { describe, expect, it } from "vitest";
import { INITIAL_GRID_STATE, assignProjectToSlot, switchTemplate } from "../grid/gridState";
import { buildSessionState, restoredTemplate, type SessionState } from "./sessionState";

describe("buildSessionState", () => {
  it("baut leere Slots aus einem leeren Grid", () => {
    const state = buildSessionState(INITIAL_GRID_STATE, {});

    expect(state).toEqual({
      template: "quad",
      slots: [null, null, null, null],
    });
  });

  it("trägt Projektpfad und Template einer belegten Pane ein", () => {
    const grid = assignProjectToSlot(
      INITIAL_GRID_STATE,
      2,
      "/repo/storefront",
      "pane-1",
    );

    const state = buildSessionState(grid, {});

    expect(state.slots[2]).toEqual({
      project_path: "/repo/storefront",
      last_selected_file: null,
    });
  });

  it("trägt die letzte ausgewählte Datei der Pane ein", () => {
    const grid = assignProjectToSlot(
      INITIAL_GRID_STATE,
      0,
      "/repo/storefront",
      "pane-1",
    );

    const state = buildSessionState(grid, { "pane-1": "src/App.tsx" });

    expect(state.slots[0]).toEqual({
      project_path: "/repo/storefront",
      last_selected_file: "src/App.tsx",
    });
  });

  it("ignoriert eine Auswahl, die zu keiner belegten Pane gehört", () => {
    const state = buildSessionState(INITIAL_GRID_STATE, {
      "verwaiste-pane": "irgendwas.txt",
    });

    expect(state.slots).toEqual([null, null, null, null]);
  });

  it("spiegelt einen Template-Wechsel", () => {
    const grid = switchTemplate(INITIAL_GRID_STATE, "split");

    expect(buildSessionState(grid, {}).template).toBe("split");
  });
});

describe("restoredTemplate", () => {
  it("übernimmt ein bekanntes Template", () => {
    const session: SessionState = { template: "row-4", slots: [] };

    expect(restoredTemplate(session)).toBe("row-4");
  });

  it("fällt bei einem unbekannten Template auf den Default zurück", () => {
    const session: SessionState = { template: "hexa-grid", slots: [] };

    expect(restoredTemplate(session)).toBe("quad");
  });
});
