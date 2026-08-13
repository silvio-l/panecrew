import { fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import { describe, expect, it, vi } from "vitest";
import type { PaneTabsProps } from "./PaneTabs";
import { TerminalPane } from "./TerminalPane";

// Tests zur TUI-Runde 2026-08-13 (Drop-Ziel-HUD + Kopiert-Bestätigung).
// `usePtyTerminal` ist komplett gemockt: hier geht es um die HUD-Schicht ÜBER
// der Terminalfläche, nicht um PTY-Verdrahtung — die deckt App.test.tsx ab.
const copySelection = vi.fn();

vi.mock("../terminal/usePtyTerminal", () => ({
  usePtyTerminal: () => ({
    containerRef: { current: null },
    copySelection,
    paste: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
    hasSelection: () => true,
    insertDroppedPaths: vi.fn(),
    spawning: false,
  }),
}));

const paneTabs: PaneTabsProps = {
  terminalTabs: [{ tabId: "tab-1", number: 1 }],
  activeTerminalTabId: "tab-1",
  showingFile: false,
  fileName: null,
  fileDirty: false,
  onSelectTerminalTab: vi.fn(),
  onOpenTerminalTab: vi.fn(),
  onCloseTerminalTab: vi.fn(),
  onSelectFile: vi.fn(),
};

const renderPane = (dropTarget: boolean) =>
  render(
    <Tooltip.Provider>
      <TerminalPane
        paneId="pane-1"
        tabId="tab-1"
        projectPath="/tmp/projekt"
        projectName="projekt"
        focused
        active
        dropTarget={dropTarget}
        tabs={paneTabs}
        dropTargets={{ register: vi.fn(), unregister: vi.fn() }}
        onClose={vi.fn()}
        onFocus={vi.fn()}
      />
    </Tooltip.Provider>,
  );

describe("TerminalPane", () => {
  it("zeigt das Drop-Ziel-HUD nur, solange ein Datei-Drag über der Pane schwebt", () => {
    const { rerender } = renderPane(true);
    expect(screen.getByText("Pfad einfügen")).toBeInTheDocument();

    rerender(
      <Tooltip.Provider>
        <TerminalPane
          paneId="pane-1"
          tabId="tab-1"
          projectPath="/tmp/projekt"
          projectName="projekt"
          focused
          active
          dropTarget={false}
          tabs={paneTabs}
          dropTargets={{ register: vi.fn(), unregister: vi.fn() }}
          onClose={vi.fn()}
          onFocus={vi.fn()}
        />
      </Tooltip.Provider>,
    );
    expect(screen.queryByText("Pfad einfügen")).not.toBeInTheDocument();
  });

  it("quittiert Kopieren über das Kontextmenü in der Live-Region", () => {
    const { container } = renderPane(false);

    // Der ContextMenu.Trigger ist der xterm-Containerdiv — das einzige
    // `div` mit Radix' data-state-Attribut in dieser Komponente (die
    // Tooltip-Trigger sind button/span).
    const trigger = container.querySelector('div[data-state="closed"]');
    if (!trigger) throw new Error("Kontextmenü-Trigger nicht gefunden");
    fireEvent.contextMenu(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Kopieren" }));

    expect(copySelection).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Kopiert");
  });
});
