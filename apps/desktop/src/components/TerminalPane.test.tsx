import { act, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneTabsProps } from "./PaneTabs";
import { TerminalPane } from "./TerminalPane";

// Tests zur TUI-Runde 2026-08-13 (Drop-Ziel-HUD + Kopiert-Bestätigung) plus
// den Fokus-/Kopier-Fehlern vom selben Tag (Tab-Wechsel, Tastatur-Kopieren).
// `usePtyTerminal` ist komplett gemockt: hier geht es um die HUD-Schicht ÜBER
// der Terminalfläche und die Verdrahtung zum Hook, nicht um die PTY selbst —
// die deckt App.test.tsx ab. `focus` und `copySelection` sind modulweite
// `vi.fn()`, damit sie über einen `rerender()` hinweg dieselbe Instanz
// bleiben (der Mock-Factory-Aufruf unten liefert sonst bei jedem Render neue
// Spione, ein `rerender` verlöre also die bisherige Aufrufhistorie).
const copySelection = vi.fn();
const focus = vi.fn();
// Der Callback, den TerminalPane.tsx als "Kopiert"-Quittung an den Hook
// reicht (Tastatur-Kopieren hat keinen eigenen UI-Weg zurück zur Pane) —
// eingefangen statt selbst aufgerufen, weil erst der Fix ihn überhaupt
// erzeugt.
let capturedOnCopied: (() => void) | undefined;

vi.mock("../terminal/usePtyTerminal", () => ({
  usePtyTerminal: (
    _tabId: string,
    _cwd: string,
    _onSelectTerminalTabByNumber: (number: number) => void,
    onCopied: () => void,
  ) => {
    capturedOnCopied = onCopied;
    return {
      containerRef: { current: null },
      copySelection,
      paste: vi.fn(),
      clear: vi.fn(),
      focus,
      hasSelection: () => true,
      insertDroppedPaths: vi.fn(),
      spawning: false,
    };
  },
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

const paneElement = (dropTarget: boolean, active: boolean) => (
  <Tooltip.Provider>
    <TerminalPane
      paneId="pane-1"
      tabId="tab-1"
      projectPath="/tmp/projekt"
      projectName="projekt"
      focused
      maximized={false}
      active={active}
      dropTarget={dropTarget}
      tabs={paneTabs}
      dropTargets={{
        register: vi.fn(),
        unregister: vi.fn(),
        paneAtPoint: vi.fn(() => null),
        insertInto: vi.fn(),
      }}
      onClose={vi.fn()}
      onFocus={vi.fn()}
      onToggleFocusMode={vi.fn()}
      focusModeHud={null}
    />
  </Tooltip.Provider>
);

const renderPane = (dropTarget: boolean, active = true) =>
  render(paneElement(dropTarget, active));

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnCopied = undefined;
});

describe("TerminalPane", () => {
  it("zeigt das Drop-Ziel-HUD nur, solange ein Datei-Drag über der Pane schwebt", () => {
    const { rerender } = renderPane(true);
    expect(screen.getByText("Pfad einfügen")).toBeInTheDocument();

    rerender(paneElement(false, true));
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

  it("holt den Fokus zurück ins Terminal, sobald dessen Tab aktiv wird", () => {
    const { rerender } = renderPane(false, false);
    expect(focus).not.toHaveBeenCalled();

    // Genau das Szenario aus dem Bugreport: der Tab wechselt (z. B. per
    // Tastatur), ohne dass die Maus je über das Terminal gefahren ist — bis
    // hierher der einzige Weg, der bislang `focus()` auslöste.
    rerender(paneElement(false, true));
    expect(focus).toHaveBeenCalledOnce();
  });

  it("stiehlt beim Mount keinen Fokus, nur weil der eigene Tab schon aktiv ist", () => {
    // Sitzungs-Restore mit mehreren Panes: jede mountet mit ihrem jeweils
    // aktiven Tab bereits `active={true}` — ohne Schutz riefe hier jede
    // Pane focus() auf, und die zuletzt gemountete gewönne den DOM-Fokus,
    // unabhängig davon, welche Pane vorher `focusedPaneId` trug.
    renderPane(false, true);
    expect(focus).not.toHaveBeenCalled();
  });

  it("quittiert Kopieren per Tastenkombination genauso wie über das Kontextmenü", () => {
    renderPane(false);
    expect(screen.queryByRole("status")).not.toHaveTextContent("Kopiert");

    if (!capturedOnCopied) {
      throw new Error("TerminalPane hat keinen onCopied-Callback übergeben");
    }
    act(() => capturedOnCopied?.());

    expect(screen.getByRole("status")).toHaveTextContent("Kopiert");
  });
});
