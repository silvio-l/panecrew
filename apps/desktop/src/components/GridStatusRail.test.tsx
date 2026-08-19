import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GridState, Pane } from "../grid/gridState";
import type { GitRepoSummary } from "../types/gitStatus";
import { GridStatusRail } from "./GridStatusRail";

const pane = (paneId: string, tabs: number): Pane => ({
  paneId,
  projectPath: `/Users/dev/projects/${paneId}`,
  terminalTabs: Array.from({ length: tabs }, (_, i) => ({
    tabId: `${paneId}-tab-${String(i)}`,
    label: null,
  })),
  activeTerminalTabId: `${paneId}-tab-0`,
  showingFile: false,
});

const state = (slots: (Pane | null)[]): GridState => ({
  template: "quad",
  slots,
  focusedPaneId: slots.find((slot) => slot !== null)?.paneId ?? null,
  maximizedPaneId: null,
  splitRatios: [],
});

describe("GridStatusRail", () => {
  it("zählt belegte Slots und alle laufenden Terminal-Sitzungen", () => {
    render(
      <GridStatusRail
        state={state([pane("a", 2), null, pane("b", 3), null])}
        focusedGitRepo={null}
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
      <GridStatusRail
        state={state([null, null, null, null])}
        focusedGitRepo={null}
      />,
    );

    // Beim ersten Start soll der Blick auf dem Projekt-Picker liegen, nicht
    // auf einer Zählung, die wie ein Fehler aussieht.
    expect(container).toBeEmptyDOMElement();
  });

  it("setzt die Einzahl, wenn genau eine Sitzung läuft", () => {
    render(
      <GridStatusRail
        state={state([pane("a", 1), null, null, null])}
        focusedGitRepo={null}
      />,
    );

    expect(
      screen.getByText("1 laufende Terminal-Sitzung insgesamt"),
    ).toBeInTheDocument();
  });

  it("zeigt keine Git-Zeile ohne erkanntes Repo", () => {
    render(
      <GridStatusRail
        state={state([pane("a", 1), null, null, null])}
        focusedGitRepo={null}
      />,
    );

    expect(screen.queryByText("dev")).not.toBeInTheDocument();
  });

  it("zeigt Branch/Dirty/Ahead-Behind der fokussierten Pane, wenn ein Repo erkannt wurde", () => {
    const gitRepo: GitRepoSummary = {
      branch: { name: "dev", detached: false, ahead: 2, behind: 0 },
      dirtyCount: 3,
      worktree: null,
    };
    render(
      <GridStatusRail
        state={state([pane("a", 1), null, null, null])}
        focusedGitRepo={gitRepo}
      />,
    );

    expect(screen.getByText("dev")).toBeInTheDocument();
    expect(screen.getByText("↑")).toBeInTheDocument();
  });
});
