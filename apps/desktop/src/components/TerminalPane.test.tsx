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
    _adapterId: string | null,
    _onSelectTerminalTabByNumber: (number: number) => void,
    _onCloseTerminalTab: () => void,
    _onOpenTerminalTab: () => void,
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
  terminalTabs: [{ tabId: "tab-1", number: 1, label: null }],
  activeTerminalTabId: "tab-1",
  paneFocused: true,
  showingFile: false,
  fileName: null,
  fileDirty: false,
  onSelectTerminalTab: vi.fn(),
  onOpenTerminalTab: vi.fn(),
  onCloseTerminalTab: vi.fn(),
  onCloseOtherTerminalTabs: vi.fn(),
  onCloseTerminalTabsToRight: vi.fn(),
  onRenameTerminalTab: vi.fn(),
  onSelectFile: vi.fn(),
  tabDrag: {
    start: vi.fn(),
    consumeClick: () => false,
    draggingTabId: null,
    draggable: true,
  },
};

const paneElement = (dropTarget: boolean, active: boolean, focused = true) => (
  <Tooltip.Provider>
    <TerminalPane
      paneId="pane-1"
      slotIndex={0}
      tabId="tab-1"
      adapterId={null}
      projectPath="/tmp/projekt"
      projectName="projekt"
      focused={focused}
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
      onHeaderPointerDown={vi.fn()}
      onToggleFocusMode={vi.fn()}
      focusModeHud={null}
      onRestartTerminatedTab={vi.fn()}
    />
  </Tooltip.Provider>
);

const renderPane = (dropTarget: boolean, active = true, focused = true) =>
  render(paneElement(dropTarget, active, focused));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: Kopieren gelingt. Der Fehlschlag-Fall (Bug 2026-08-14: Toast
  // erschien früher unabhängig vom tatsächlichen Zwischenablage-Ergebnis)
  // stellt sich unten selbst per `mockReturnValue(false)` ein.
  copySelection.mockReturnValue(true);
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

  it("quittiert NICHT, wenn das Kopieren über das Kontextmenü tatsächlich fehlschlägt", () => {
    // Regressionstest für den Bug vom 2026-08-14: die Quittung feuerte
    // bisher unabhängig davon, ob wirklich etwas in der Zwischenablage
    // gelandet ist (copySelection() lieferte gar kein Ergebnis zurück,
    // copyWithFeedback() rief notifyCopied() unbedingt auf).
    copySelection.mockReturnValue(false);
    const { container } = renderPane(false);

    const trigger = container.querySelector('div[data-state="closed"]');
    if (!trigger) throw new Error("Kontextmenü-Trigger nicht gefunden");
    fireEvent.contextMenu(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Kopieren" }));

    expect(copySelection).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).not.toHaveTextContent("Kopiert");
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

  it("holt den Fokus zurück ins Terminal, sobald die Pane fokussiert wird — auch ohne Tab-Wechsel", () => {
    // Das Pin-Header-Szenario (FocusPinHeader.tsx) und Cmd+1..4/Fokus-
    // Rotation bei Panes mit nur einem Tab: `active` bleibt durchgehend
    // `true`, nur `focusedPaneId` im Grid-Store wechselt auf diese Pane.
    const { rerender } = renderPane(false, true, false);
    expect(focus).not.toHaveBeenCalled();

    rerender(paneElement(false, true, true));
    expect(focus).toHaveBeenCalledOnce();
  });

  it("holt keinen Fokus, solange die Pane unfokussiert bleibt, auch wenn ihr Tab aktiv wird", () => {
    // Absichtliche Einschränkung ggü. dem reinen Tab-Wechsel-Fall oben: ein
    // aktiv werdender Tab in einer nicht fokussierten Pane darf ihr
    // verstecktes Terminal nicht heimlich zum DOM-Fokus-Ziel machen.
    const { rerender } = renderPane(false, false, false);
    expect(focus).not.toHaveBeenCalled();

    rerender(paneElement(false, true, false));
    expect(focus).not.toHaveBeenCalled();
  });

  it("meldet die Drop-Registrierung beim Pane-Wechsel um (Ticket 32)", () => {
    // Ein verschobener Terminal-Tab wird NICHT neu gemountet (das ist der
    // ganze Punkt des Tickets) — seine `paneId`-Prop wechselt einfach. Ohne
    // diese Ummeldung lieferte ein Finder-Drop danach in die alte Pane, und
    // zwar lautlos: sichtbar wäre nur, dass der Pfad in einem anderen
    // Terminal landet als dem, auf das gezielt wurde.
    const dropTargets = {
      register: vi.fn(),
      unregister: vi.fn(),
      paneAtPoint: vi.fn(() => null),
      insertInto: vi.fn(),
    };
    const element = (paneId: string) => (
      <Tooltip.Provider>
        <TerminalPane
          paneId={paneId}
          slotIndex={0}
          tabId="tab-1"
          adapterId={null}
          projectPath="/tmp/projekt"
          projectName="projekt"
          focused
          maximized={false}
          active
          dropTarget={false}
          tabs={paneTabs}
          dropTargets={dropTargets}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onHeaderPointerDown={vi.fn()}
          onToggleFocusMode={vi.fn()}
          focusModeHud={null}
          onRestartTerminatedTab={vi.fn()}
        />
      </Tooltip.Provider>
    );

    const { rerender } = render(element("pane-1"));
    expect(dropTargets.register).toHaveBeenCalledWith(
      "pane-1",
      expect.any(Function),
    );

    rerender(element("pane-2"));
    expect(dropTargets.unregister).toHaveBeenCalledWith("pane-1");
    expect(dropTargets.register).toHaveBeenCalledWith(
      "pane-2",
      expect.any(Function),
    );
  });

  it("holt den Fokus zurück, wenn der Tab die Pane gewechselt hat (Ticket 32)", () => {
    // `active` und `focused` bleiben beim Zug beide `true` — nur die `paneId`
    // wechselt. Das Umhängen des DOM-Knotens nimmt den Fokus mit auf
    // `<body>`, deshalb muss dieser Fall eigens erkannt werden.
    const element = (paneId: string) => (
      <Tooltip.Provider>
        <TerminalPane
          paneId={paneId}
          slotIndex={0}
          tabId="tab-1"
          adapterId={null}
          projectPath="/tmp/projekt"
          projectName="projekt"
          focused
          maximized={false}
          active
          dropTarget={false}
          tabs={paneTabs}
          dropTargets={{
            register: vi.fn(),
            unregister: vi.fn(),
            paneAtPoint: vi.fn(() => null),
            insertInto: vi.fn(),
          }}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onHeaderPointerDown={vi.fn()}
          onToggleFocusMode={vi.fn()}
          focusModeHud={null}
          onRestartTerminatedTab={vi.fn()}
        />
      </Tooltip.Provider>
    );

    const { rerender } = render(element("pane-1"));
    expect(focus).not.toHaveBeenCalled();

    rerender(element("pane-2"));
    expect(focus).toHaveBeenCalledOnce();
  });

  it("holt den Fokus zurück, wenn die eigene Zelle den Slot gewechselt hat (Ticket 20)", () => {
    // Slot-Tausch: `active`, `focused` und `paneId` bleiben alle unverändert,
    // nur die Position der Zelle unter ihren Geschwistern wechselt — React
    // sortiert dafür einen eingehängten Knoten um, und das kostet im echten
    // Browser den Fokus. jsdom bildet diese Fokus-Korrektur nicht nach, hier
    // steht deshalb bewusst nur, dass der Übergang als solcher erkannt wird.
    const element = (slotIndex: number) => (
      <Tooltip.Provider>
        <TerminalPane
          paneId="pane-1"
          slotIndex={slotIndex}
          tabId="tab-1"
          adapterId={null}
          projectPath="/tmp/projekt"
          projectName="projekt"
          focused
          maximized={false}
          active
          dropTarget={false}
          tabs={paneTabs}
          dropTargets={{
            register: vi.fn(),
            unregister: vi.fn(),
            paneAtPoint: vi.fn(() => null),
            insertInto: vi.fn(),
          }}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onHeaderPointerDown={vi.fn()}
          onToggleFocusMode={vi.fn()}
          focusModeHud={null}
          onRestartTerminatedTab={vi.fn()}
        />
      </Tooltip.Provider>
    );

    const { rerender } = render(element(0));
    expect(focus).not.toHaveBeenCalled();

    rerender(element(1));
    expect(focus).toHaveBeenCalledOnce();
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
