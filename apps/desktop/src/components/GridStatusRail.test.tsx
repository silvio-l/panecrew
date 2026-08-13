import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GridState, Pane } from "../grid/gridState";
import { GridStatusRail } from "./GridStatusRail";

const pane = (paneId: string, tabs: number): Pane => ({
  paneId,
  projectPath: `/Users/dev/projects/${paneId}`,
  terminalTabs: Array.from({ length: tabs }, (_, i) => ({
    tabId: `${paneId}-tab-${String(i)}`,
  })),
  activeTerminalTabId: `${paneId}-tab-0`,
  showingFile: false,
});

const state = (slots: (Pane | null)[]): GridState => ({
  template: "quad",
  slots,
  focusedPaneId: slots.find((slot) => slot !== null)?.paneId ?? null,
});

describe("GridStatusRail", () => {
  it("zählt belegte Slots und alle laufenden Terminal-Sitzungen", () => {
    render(
      <GridStatusRail
        state={state([pane("a", 2), null, pane("b", 3), null])}
      />,
    );

    // Sichtbar sind nur Ziffern — die Bedeutung trägt der Satz für
    // Screenreader (Register-Regel in `HudReadout`).
    expect(screen.getByText("2/4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(
      screen.getByText("2 von 4 Rasterflächen belegt"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("5 laufende Terminal-Sitzungen insgesamt"),
    ).toBeInTheDocument();
  });

  it("bleibt im leeren Raster ganz weg, statt „0/4“ zu zeigen", () => {
    const { container } = render(
      <GridStatusRail state={state([null, null, null, null])} />,
    );

    // Beim ersten Start soll der Blick auf dem Projekt-Picker liegen, nicht
    // auf einer Zählung, die wie ein Fehler aussieht.
    expect(container).toBeEmptyDOMElement();
  });

  it("setzt die Einzahl, wenn genau eine Sitzung läuft", () => {
    render(<GridStatusRail state={state([pane("a", 1), null, null, null])} />);

    expect(
      screen.getByText("1 laufende Terminal-Sitzung insgesamt"),
    ).toBeInTheDocument();
  });
});
