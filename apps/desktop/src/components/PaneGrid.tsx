// Das Grid: N unabhängige Panes in der Geometrie des aktiven Templates, ein
// leerer Slot zeigt seinen eigenen Picker.
//
// Invariante: jede Zelle ist direktes Kind DIESES Grid-Containers, in einem
// flachen Array. Belegte Zellen sind nach `paneId` geschlüsselt, leere nach
// Slot-Index — nie ein pro-Region-Wrapper-`<div>`, der nach Slot-Index
// geschlüsselt ist, sonst würde eine Kompaktierung (Quad→Geteilt mit Panes an
// Slot 0 und 3) über einen Index-Key-Wechsel unmounten und per
// `usePtyTerminal`s Cleanup eine lebende PTY killen.
//
// Daraus folgt unmittelbar, wie die sieben Templates aussehen dürfen: als
// Klasse am Container, nie als Struktur darin. Kein Template fügt ein Kind
// hinzu, entfernt eines oder sortiert um — deshalb ist der Unterschied
// zwischen Quad und Viererreihe für React gar kein Unterschied, und deshalb
// überlebt jede PTY jeden Wechsel. Die Spuren selbst stehen in App.css.
import { fileNameFromPath } from "../explorer/filePath";
import type { PaneFileEditors } from "../explorer/usePaneFileEditors";
import type { GridState, Pane } from "../grid/gridState";
import {
  useWebviewFileDrop,
  type PaneDropRegistration,
} from "../terminal/useWebviewFileDrop";
import { projectNameFromPath } from "../types/project";
import type { PaneTabsProps } from "./PaneTabs";
import { FileEditor } from "./FileEditor";
import { ProjectPicker } from "./ProjectPicker";
import { TerminalPane } from "./TerminalPane";

export function PaneGrid({
  state,
  paneFileEditors,
  guardLeave,
  pickingSlot,
  restoringSlots,
  zoom,
  onAssignProject,
  onClosePane,
  onFocusPane,
  onOpenTerminalTab,
  onCloseTerminalTab,
  onSwitchToTerminalTab,
  onSwitchToFileTab,
}: {
  state: GridState;
  paneFileEditors: PaneFileEditors;
  guardLeave: (paneId: string, run: () => void) => void;
  /** Welcher leere Slot gerade auf den Ordner-Dialog wartet — `null`, wenn
   * keiner. Der native Dialog ist ohnehin modal, es kann also nie mehr als
   * einer gleichzeitig sein. */
  pickingSlot: number | null;
  /** Slot-Indizes, die die wiederhergestellte Sitzung noch befüllen will
   * (App.tsx, bis `hydrated` kippt) — ihr Picker zeigt einen Ladehinweis
   * statt eines klickbaren Knopfs. */
  restoringSlots: ReadonlySet<number>;
  /** Für die Drop-Positionsprüfung (`useWebviewFileDrop.ts`) — physische
   * Drop-Koordinaten sind vom App-Zoom mitskaliert. */
  zoom: number;
  onAssignProject: (slotIndex: number) => void;
  onClosePane: (paneId: string) => void;
  onFocusPane: (paneId: string) => void;
  onOpenTerminalTab: (paneId: string) => void;
  onCloseTerminalTab: (paneId: string, tabId: string) => void;
  onSwitchToTerminalTab: (paneId: string, tabId: string) => void;
  onSwitchToFileTab: (paneId: string) => void;
}) {
  // Die eine Drag-Drop-Registrierung für das ganze Grid (Begründung dort).
  const dropTargets = useWebviewFileDrop(zoom);

  return (
    // Der Template-Wechsel ändert GENAU DIESE Klasse und sonst nichts am Baum
    // — Spuren und Spannen aller sieben Geometrien stehen in App.css
    // (`.pc-layout--*`), die Begründung dafür ebenfalls dort.
    <div className={`pc-workspace pc-layout--${state.template}`}>
      {state.slots.map((slot, index) =>
        slot ? (
          <PaneCell
            key={slot.paneId}
            pane={slot}
            focused={slot.paneId === state.focusedPaneId}
            editor={paneFileEditors.editorFor(slot.paneId)}
            guardLeave={guardLeave}
            dropTargets={dropTargets}
            onClose={() => onClosePane(slot.paneId)}
            onFocus={() => onFocusPane(slot.paneId)}
            onOpenTerminalTab={onOpenTerminalTab}
            onCloseTerminalTab={onCloseTerminalTab}
            onSwitchToTerminalTab={onSwitchToTerminalTab}
            onSwitchToFileTab={onSwitchToFileTab}
          />
        ) : (
          <ProjectPicker
            key={`empty-slot-${index}`}
            onChoose={() => onAssignProject(index)}
            busy={pickingSlot === index}
            restoring={restoringSlots.has(index)}
          />
        ),
      )}
    </div>
  );
}

function PaneCell({
  pane,
  focused,
  editor,
  guardLeave,
  dropTargets,
  onClose,
  onFocus,
  onOpenTerminalTab,
  onCloseTerminalTab,
  onSwitchToTerminalTab,
  onSwitchToFileTab,
}: {
  pane: Pane;
  focused: boolean;
  editor: ReturnType<PaneFileEditors["editorFor"]>;
  guardLeave: (paneId: string, run: () => void) => void;
  dropTargets: PaneDropRegistration;
  onClose: () => void;
  onFocus: () => void;
  onOpenTerminalTab: (paneId: string) => void;
  onCloseTerminalTab: (paneId: string, tabId: string) => void;
  onSwitchToTerminalTab: (paneId: string, tabId: string) => void;
  onSwitchToFileTab: (paneId: string) => void;
}) {
  // `pane.showingFile` ist reine Nutzer-ABSICHT (gridState.ts kennt keinen
  // Dateizustand) — ob dazu wirklich eine Fläche existiert, weiß nur der
  // Editor-Zustand hier. Ohne diesen Abgleich bliebe eine Pane nach einem
  // wiederhergestellten `active_tab: {kind:"file"}` auf einen inzwischen
  // ungültigen Pfad tot: FileEditor liefert bei `status === "idle"` `null`,
  // und kein Terminal-Tab wäre je sichtbar. `showingFile` unten ist deshalb
  // die für DIESES Rendern gültige, abgeleitete Ansicht — nicht `pane`s
  // Rohfeld.
  const openPath = editor.state.status === "idle" ? null : editor.state.path;
  const showingFile = pane.showingFile && openPath !== null;

  const tabs: PaneTabsProps = {
    terminalTabs: pane.terminalTabs.map((tab, i) => ({
      tabId: tab.tabId,
      number: i + 1,
    })),
    activeTerminalTabId: pane.activeTerminalTabId,
    showingFile,
    fileName: openPath === null ? null : fileNameFromPath(openPath),
    fileDirty: editor.wouldLoseWork,
    onSelectTerminalTab: (tabId) => onSwitchToTerminalTab(pane.paneId, tabId),
    onOpenTerminalTab: () => onOpenTerminalTab(pane.paneId),
    onCloseTerminalTab: (tabId) => onCloseTerminalTab(pane.paneId, tabId),
    onSelectFile: () => onSwitchToFileTab(pane.paneId),
  };

  return (
    // `relative`, damit die absolut positionierten Flächen darunter (jeder
    // Terminal-Tab UND der File-Tab) sich exakt auf DIESE Zelle beziehen,
    // nicht auf das ganze Grid.
    <div className="relative flex min-h-0 min-w-0 flex-col">
      {/* Wie zuvor: jede Fläche bleibt gemountet, nur ausgeblendet — ein
          Unmount würde über `usePtyTerminal`s Cleanup `pty_kill` auslösen.
          Seit Ticket 18 sind das bis zu N Terminal-Tabs gleichzeitig statt
          einem, deshalb reicht das frühere `hidden`-Attribut (= `display:
          none`) nicht mehr: ein inaktiver Tab wäre beim Öffnen 0×0 groß, denn
          `usePtyTerminal.ts`s `fitAddon.fit()` misst die Containerbox beim
          Mount, und `display: none` nimmt sie komplett aus dem Layout. Jede
          Fläche liegt deshalb `absolute inset-0` exakt übereinander und wird
          nur per inline `visibility: hidden` ausgeblendet (nicht per
          Tailwind-Klasse, Begründung dort) — das lässt den Platz im Layout,
          xterm.js misst also auch als inaktiver Tab korrekt, und nimmt
          Klicks/Drops gleich mit raus, ohne ein zusätzliches
          `pointer-events: none` zu brauchen. */}
      {pane.terminalTabs.map((tab) => {
        const isActiveTab = tab.tabId === pane.activeTerminalTabId;
        const isVisible = isActiveTab && !showingFile;
        return (
          <div
            key={tab.tabId}
            className="absolute inset-0 flex min-h-0 flex-col"
            // Inline statt einer Tailwind-Klasse: `visibility: hidden` allein
            // reicht (nimmt Klicks/Fokus schon von sich aus raus, ein
            // zusätzliches `pointer-events: none` wäre doppelt), und inline
            // gesetzt ist es unabhängig vom geladenen Stylesheet real
            // vorhanden — u. a. Voraussetzung dafür, dass Testing Librarys
            // `toBeVisible()` es überhaupt sieht.
            style={isVisible ? undefined : { visibility: "hidden" }}
          >
            <TerminalPane
              paneId={pane.paneId}
              tabId={tab.tabId}
              projectPath={pane.projectPath}
              projectName={projectNameFromPath(pane.projectPath)}
              focused={focused}
              // Unabhängig von `showingFile`: genau EIN Terminal-Tab je Pane
              // trägt die Drop-Registrierung (`useWebviewFileDrop.ts`),
              // exakt wie vor Ticket 18 (ein Terminal pro Pane, immer
              // registriert) — nur jetzt korrekt an den AKTIVEN von N Tabs
              // gebunden statt zufällig an den zuletzt gemounteten.
              active={isActiveTab}
              tabs={tabs}
              dropTargets={dropTargets}
              onClose={onClose}
              onFocus={onFocus}
            />
          </div>
        );
      })}
      <div
        className="absolute inset-0 flex min-h-0 flex-col"
        style={showingFile ? undefined : { visibility: "hidden" }}
      >
        <FileEditor
          state={editor.state}
          focused={focused}
          tabs={tabs}
          onEdit={editor.editContent}
          onSave={editor.save}
          onClose={() => guardLeave(pane.paneId, editor.close)}
        />
      </div>
    </div>
  );
}
