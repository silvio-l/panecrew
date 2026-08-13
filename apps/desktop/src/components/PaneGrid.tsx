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
import { useRef, type CSSProperties } from "react";
import { fileNameFromPath } from "../explorer/filePath";
import type { PaneFileEditors } from "../explorer/usePaneFileEditors";
import type { GridState, Pane } from "../grid/gridState";
import { useGridTransitions } from "../grid/useGridTransitions";
import type { FocusRotation } from "../grid/useFocusRotation";
import type { PaneDropRegistration } from "../terminal/useWebviewFileDrop";
import { projectNameFromPath } from "../types/project";
import type { PaneTabsProps } from "./PaneTabs";
import { FileEditor } from "./FileEditor";
import { FocusModeHud } from "./FocusModeHud";
import { ProjectPicker } from "./ProjectPicker";
import { TerminalPane } from "./TerminalPane";

export function PaneGrid({
  state,
  paneFileEditors,
  guardLeave,
  pickingSlot,
  restoringSlots,
  dropTargets,
  dragTargetPaneId,
  onAssignProject,
  onClosePane,
  onFocusPane,
  onOpenTerminalTab,
  onCloseTerminalTab,
  onRenameTerminalTab,
  onSwitchToTerminalTab,
  onSwitchToFileTab,
  onEnterFocusMode,
  onExitFocusMode,
  rotation,
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
  /** Die eine Drop-Registrierung, seit dem Explorer-Ziehen von `App.tsx`
   * gehalten statt hier erzeugt (Begründung dort) — beide Drop-Quellen
   * brauchen sie, und die eine beginnt außerhalb dieses Baums. */
  dropTargets: PaneDropRegistration;
  /** Die Pane unter einem schwebenden Drag, aus welcher Quelle auch immer —
   * `null`, wenn gerade keine. `App.tsx` führt die beiden Quellen zu diesem
   * einen Wert zusammen, damit das Drop-Ziel-HUD hier nicht zwei Herkünfte
   * auseinanderhalten muss: für die Pane ist beides derselbe Zustand. */
  dragTargetPaneId: string | null;
  onAssignProject: (slotIndex: number) => void;
  onClosePane: (paneId: string) => void;
  onFocusPane: (paneId: string) => void;
  onOpenTerminalTab: (paneId: string) => void;
  onCloseTerminalTab: (paneId: string, tabId: string) => void;
  /** Kontextmenü-Aktion "Umbenennen" (`PaneTabs.tsx`) — `label: null` löscht
   * den Namen wieder. */
  onRenameTerminalTab: (paneId: string, tabId: string, label: string | null) => void;
  onSwitchToTerminalTab: (paneId: string, tabId: string) => void;
  onSwitchToFileTab: (paneId: string) => void;
  /** Versetzt eine Pane in den Fokus-Modus (Ticket 19) — der Klick auf den
   * Maximieren-Knopf im Pane-Header. */
  onEnterFocusMode: (paneId: string) => void;
  /** Verlässt den Fokus-Modus — derselbe Knopf im Header der maximierten
   * Pane ruft je nach `maximized` diese oder `onEnterFocusMode` auf (s.
   * `onToggleFocusMode` unten). */
  onExitFocusMode: () => void;
  /** Rotationsmodus-Zustand + Bedienung (`grid/useFocusRotation.ts`),
   * gehalten in `App.tsx` — hier nur gereicht an die HUD-Leiste der
   * maximierten Zelle. */
  rotation: FocusRotation;
}) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  // Weiche Übergänge für Template-Wechsel und Fokus-Modus (FLIP, s.
  // useGridTransitions.ts) — reine WAAPI-Animationen auf den bestehenden
  // Zellen, die Unmount-Invariante dieses Baums (Kopfkommentar) bleibt
  // unberührt. Die Schlüssel entsprechen exakt den React-Keys unten, denn
  // DOM-Reihenfolge = Slot-Reihenfolge (dieselbe Invariante).
  useGridTransitions(
    workspaceRef,
    state.slots.map((slot, index) => slot?.paneId ?? `empty-slot-${index}`),
    state.template,
    state.maximizedPaneId,
  );
  return (
    // Der Template-Wechsel ändert GENAU DIESE Klasse und sonst nichts am Baum
    // — Spuren und Spannen aller sieben Geometrien stehen in App.css
    // (`.pc-layout--*`), die Begründung dafür ebenfalls dort. Der Fokus-Modus
    // ist orthogonal dazu (`gridState.ts`s Kopfkommentar zu
    // `maximizedPaneId`): das Template bleibt unverändert stehen, nur EINE
    // Zelle wird per `grid-area`-Inline-Style auf das ganze Raster gespannt
    // (s. u.) — kein Unmount, keine zweite Layout-Klasse nötig.
    <div ref={workspaceRef} className={`pc-workspace pc-layout--${state.template}`}>
      {state.slots.map((slot, index) =>
        slot ? (
          <PaneCell
            key={slot.paneId}
            pane={slot}
            focused={slot.paneId === state.focusedPaneId}
            maximized={slot.paneId === state.maximizedPaneId}
            focusModeActive={state.maximizedPaneId !== null}
            slotNumber={index + 1}
            totalSlots={state.slots.length}
            rotation={rotation}
            dropTarget={slot.paneId === dragTargetPaneId}
            editor={paneFileEditors.editorFor(slot.paneId)}
            guardLeave={guardLeave}
            dropTargets={dropTargets}
            onClose={() => onClosePane(slot.paneId)}
            onFocus={() => onFocusPane(slot.paneId)}
            onOpenTerminalTab={onOpenTerminalTab}
            onCloseTerminalTab={onCloseTerminalTab}
            onRenameTerminalTab={onRenameTerminalTab}
            onSwitchToTerminalTab={onSwitchToTerminalTab}
            onSwitchToFileTab={onSwitchToFileTab}
            // Derselbe Header-Knopf ist Ein- und Ausstieg zugleich: eine
            // maximierte Pane bietet "verlassen" an, jede andere "maximieren"
            // — zwei Aktionen, aber immer nur EIN sichtbarer Knopf pro Zelle.
            onToggleFocusMode={() =>
              slot.paneId === state.maximizedPaneId
                ? onExitFocusMode()
                : onEnterFocusMode(slot.paneId)
            }
          />
        ) : (
          <ProjectPicker
            key={`empty-slot-${index}`}
            onChoose={() => onAssignProject(index)}
            busy={pickingSlot === index}
            restoring={restoringSlots.has(index)}
            slotNumber={index + 1}
            focusModeActive={state.maximizedPaneId !== null}
          />
        ),
      )}
    </div>
  );
}

function PaneCell({
  pane,
  focused,
  maximized,
  focusModeActive,
  slotNumber,
  dropTarget,
  editor,
  guardLeave,
  dropTargets,
  onClose,
  onFocus,
  onOpenTerminalTab,
  onCloseTerminalTab,
  onRenameTerminalTab,
  onSwitchToTerminalTab,
  onSwitchToFileTab,
  onToggleFocusMode,
  totalSlots,
  rotation,
}: {
  pane: Pane;
  focused: boolean;
  /** Ob GENAU DIESE Pane gerade den Fokus-Modus trägt (Ticket 19) — sie
   * spannt sich per `grid-area` über das ganze Raster, alle übrigen Zellen
   * bleiben gemountet, werden aber unsichtbar (s. u.). */
  maximized: boolean;
  /** Ob IRGENDEINE Pane gerade maximiert ist — auch für die anderen Zellen
   * relevant, die dann `visibility: hidden` bekommen statt ihrer normalen
   * Sichtbarkeit. */
  focusModeActive: boolean;
  /** 1-basiert, wie die Zahlen-Hotkeys im Fokus-Modus — dieselbe Zahl wie
   * `ProjectPicker`s Slot-Beschriftung. */
  slotNumber: number;
  /** Ob ein Datei-Drag gerade über DIESER Pane schwebt (`useWebviewFileDrop`)
   * — der aktive Terminal-Tab zeigt dann sein Drop-Ziel-HUD. */
  dropTarget: boolean;
  editor: ReturnType<PaneFileEditors["editorFor"]>;
  guardLeave: (paneId: string, run: () => void) => void;
  dropTargets: PaneDropRegistration;
  onClose: () => void;
  onFocus: () => void;
  onOpenTerminalTab: (paneId: string) => void;
  onCloseTerminalTab: (paneId: string, tabId: string) => void;
  onRenameTerminalTab: (paneId: string, tabId: string, label: string | null) => void;
  onSwitchToTerminalTab: (paneId: string, tabId: string) => void;
  onSwitchToFileTab: (paneId: string) => void;
  /** Ein Aufruf deckt beide Richtungen ab — s. `PaneGrid`s Berechnung oben:
   * maximiert diese Pane, wenn sie es noch nicht ist, sonst verlässt sie den
   * Fokus-Modus. */
  onToggleFocusMode: () => void;
  /** Für die HUD-Leiste der maximierten Zelle: "2/4"-Positionsanzeige. */
  totalSlots: number;
  /** Rotationsmodus-Zustand + Bedienung, gereicht an `FocusModeHud.tsx`. */
  rotation: FocusRotation;
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
      label: tab.label,
    })),
    activeTerminalTabId: pane.activeTerminalTabId,
    showingFile,
    fileName: openPath === null ? null : fileNameFromPath(openPath),
    fileDirty: editor.wouldLoseWork,
    onSelectTerminalTab: (tabId) => onSwitchToTerminalTab(pane.paneId, tabId),
    onOpenTerminalTab: () => onOpenTerminalTab(pane.paneId),
    onCloseTerminalTab: (tabId) => onCloseTerminalTab(pane.paneId, tabId),
    onRenameTerminalTab: (tabId, label) => onRenameTerminalTab(pane.paneId, tabId, label),
    onSelectFile: () => onSwitchToFileTab(pane.paneId),
  };

  // Fokus-Modus-Geometrie (Ticket 19): KEIN Unmount, KEINE zweite
  // Layout-Klasse am `.pc-workspace` — dieselbe Zelle bleibt an ihrem
  // Grid-Platz, nur zwei Inline-Werte ändern sich.
  //
  // Die maximierte Zelle bekommt `position: absolute; inset: 0` (Anker ist
  // `.pc-workspace`s eigenes `position: relative`, App.css) statt einer
  // `grid-area`-Spannung über `1 / 1 / -1 / -1` — Letzteres sah auf dem Papier
  // richtig aus (row/col-Kurzform bis zur letzten Linie, trifft jedes
  // Template gleichermaßen), brach aber am eigentlichen Verhalten von CSS
  // Grid: eine explizit über das GESAMTE Raster gespannte Zelle blockiert für
  // die ÜBRIGEN, weiterhin nur `auto`-platzierten Geschwister jede freie
  // Zelle der expliziten Spuren — die Auto-Platzierung weicht ihnen dann in
  // NEUE implizite Zeilen darunter aus, statt sie (wie beabsichtigt) einfach
  // unsichtbar unter der maximierten Zelle liegen zu lassen. Ergebnis: die
  // expliziten Spuren schrumpfen auf einen Bruchteil der Rasterhöhe, und die
  // maximierte Zelle füllt zwar die volle Breite, aber nur einen Teil der
  // Höhe (am Vierergrid 2026-08-13 im Demo-Harness sichtbar geworden — vier
  // statt zwei Zeilenspuren in den DevTools). `position: absolute` nimmt die
  // Zelle komplett aus der Grid-Auto-Platzierung heraus: die übrigen drei
  // Geschwister bekommen ihre normalen, aus dem Template ableitbaren
  // Zellen zurück (eine bleibt dabei ungenutzt, unsichtbar unter der
  // Absolut-Fläche), und `inset: 0` deckt exakt die Innenfläche von
  // `.pc-workspace` ab — randlos, auch über den 0.5rem-`gap` hinweg, der sonst
  // zwischen Grid-Zellen sichtbar wäre.
  //
  // Alle ANDEREN Zellen bekommen `visibility: hidden` — nicht `display:
  // none`: Letzteres kollabiert die Containerbox jedes Nachfahren auf 0×0,
  // exakt der Grund, warum schon die Terminal-Tab-Sichtbarkeit direkt
  // darunter (Kommentar dort) dasselbe Muster verwendet. Ohne diesen
  // Unterschied verlöre `fitAddon.fit()` beim Verlassen des Fokus-Modus seine
  // Messbasis. Dasselbe gilt für leere Slots (`ProjectPicker.tsx`s eigene
  // `focusModeActive`-Prop).
  const cellStyle: CSSProperties | undefined = maximized
    ? { position: "absolute", inset: 0, zIndex: 30 }
    : focusModeActive
      ? { visibility: "hidden" }
      : undefined;

  // Rotations-Cluster des Fokus-Modus (Ticket 19) — EINMAL pro Zelle
  // berechnet und identisch an TerminalPane.tsx UND FileEditor.tsx gereicht
  // (Begründung/Platzierung im Pane-Header statt als freischwebendes Overlay:
  // FocusModeHud.tsx-Kopfkommentar). `null` für jede nicht-maximierte Zelle —
  // beide Flächen rendern dann einfach nichts an der Stelle.
  const focusModeHud = maximized ? (
    <FocusModeHud slotNumber={slotNumber} totalSlots={totalSlots} rotation={rotation} />
  ) : null;

  return (
    // `relative`, damit die absolut positionierten Flächen darunter (jeder
    // Terminal-Tab UND der File-Tab) sich exakt auf DIESE Zelle beziehen,
    // nicht auf das ganze Grid.
    <div className="relative flex min-h-0 min-w-0 flex-col" style={cellStyle}>
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
              maximized={maximized}
              // Unabhängig von `showingFile`: genau EIN Terminal-Tab je Pane
              // trägt die Drop-Registrierung (`useWebviewFileDrop.ts`),
              // exakt wie vor Ticket 18 (ein Terminal pro Pane, immer
              // registriert) — nur jetzt korrekt an den AKTIVEN von N Tabs
              // gebunden statt zufällig an den zuletzt gemounteten.
              active={isActiveTab}
              dropTarget={dropTarget}
              tabs={tabs}
              dropTargets={dropTargets}
              onClose={onClose}
              onFocus={onFocus}
              onToggleFocusMode={onToggleFocusMode}
              focusModeHud={focusModeHud}
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
          maximized={maximized}
          projectName={projectNameFromPath(pane.projectPath)}
          tabs={tabs}
          onEdit={editor.editContent}
          onSave={editor.save}
          onClose={() => guardLeave(pane.paneId, editor.close)}
          onToggleFocusMode={onToggleFocusMode}
          focusModeHud={focusModeHud}
        />
      </div>
    </div>
  );
}
