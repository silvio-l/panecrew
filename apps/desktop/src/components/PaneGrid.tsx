// Das Grid: N unabhängige Panes in der Geometrie des aktiven Templates, ein
// leerer Slot zeigt seinen eigenen Picker.
//
// Invariante: jede Zelle ist direktes Kind DIESES Grid-Containers, in einem
// flachen Array. Belegte Zellen sind nach `paneId` geschlüsselt, leere nach
// Slot-Index — nie ein pro-Region-Wrapper-`<div>`, der nach Slot-Index
// geschlüsselt ist, sonst würde eine Kompaktierung (Quad→Geteilt mit Panes an
// Slot 0 und 3) über einen Index-Key-Wechsel unmounten und per
// `usePtyTerminal`s Cleanup eine lebende PTY killen. Seit Ticket 20 hängt am
// selben Array noch ein Zweites: der Slot-Tausch IST dieses Umsortieren, und
// `useGridTransitions.ts` liest die DOM-Reihenfolge der Kinder positionsweise
// gegen dieselben Schlüssel — beide brächen, sobald hier etwas anderes als
// genau ein Kind je Slot stünde. (Die Portale unten erzeugen an dieser Stelle
// KEIN DOM, sie sind nur fiber-seitig Kinder — die Kinderliste des
// `.pc-workspace` bleibt exakt die Slot-Liste.)
//
// Daraus folgt unmittelbar, wie die sieben Templates aussehen dürfen: als
// Klasse am Container, nie als Struktur darin. Kein Template fügt ein Kind
// hinzu, entfernt eines oder sortiert um — deshalb ist der Unterschied
// zwischen Quad und Viererreihe für React gar kein Unterschied, und deshalb
// überlebt jede PTY jeden Wechsel. Die Spuren selbst stehen in App.css.
//
// Terminal-Tabs (Ticket 32) hängen NICHT mehr in ihrer Zelle, sondern als
// flache Liste hier: je Tab ein Portal in einen stabilen, nicht von React
// verwalteten Container (`grid/useTerminalTabHosts.ts`), der per DOM in die
// Host-Fläche seiner gerade besitzenden Pane gehängt wird. Nur so kann ein Tab
// die Pane wechseln, ohne unmountet — und damit seine PTY gekillt — zu
// werden; die ausführliche Begründung steht im Kopfkommentar jenes Hooks.
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { fileNameFromPath } from "../explorer/filePath";
import type { PaneFileEditors } from "../explorer/usePaneFileEditors";
import type { GridState, Pane } from "../grid/gridState";
import { useGridTransitions } from "../grid/useGridTransitions";
import { usePaneDrag } from "../grid/usePaneDrag";
import { useTerminalTabHosts, type TabOwnership } from "../grid/useTerminalTabHosts";
import type { FocusRotation } from "../grid/useFocusRotation";
import type { PaneDropRegistration } from "../terminal/useWebviewFileDrop";
import { projectNameFromPath } from "../types/project";
import type { PaneTabsProps } from "./PaneTabs";
import { FileEditor } from "./FileEditor";
import { FocusModeHud } from "./FocusModeHud";
import { PaneDropInvite } from "./PaneDropInvite";
import { ProjectPicker } from "./ProjectPicker";
import { TabDragGhost } from "./TabDragGhost";
import { TerminalPane } from "./TerminalPane";

/** Alles, was für EINE belegte Zelle einmal zentral abgeleitet wird — Zelle
 * und Terminal-Tabs liegen seit Ticket 32 in zwei getrennten Teilbäumen und
 * brauchen dieselben Werte (allen voran `tabs`: die Tab-Leiste ist in beiden
 * Flächen dasselbe Objekt, s. `PaneTabsProps`). Zweimal abgeleitet wären sie
 * zwei Wahrheiten, die auseinanderlaufen können. */
interface PaneView {
  pane: Pane;
  /** Der Slot, in dem diese Pane GERADE liegt. Nur für die Fokus-Übergabe
   * relevant (Ticket 20, s. `TerminalPane.tsx`' vierte Bedingung): ein Tausch
   * sortiert die Zellen im DOM um, und React bewegt dafür einen bereits
   * eingehängten Knoten — der verliert dabei den Fokus. */
  slotIndex: number;
  focused: boolean;
  maximized: boolean;
  /** Die für DIESES Rendern gültige, abgeleitete Ansicht — nicht `pane`s
   * Rohfeld (s. Herleitung unten). */
  showingFile: boolean;
  tabs: PaneTabsProps;
  focusModeHud: ReactNode;
  dropInvite: ReactNode;
  dragSource: boolean;
  fileDropTarget: boolean;
  editor: ReturnType<PaneFileEditors["editorFor"]>;
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onToggleFocusMode: () => void;
  onClose: () => void;
  onFocus: () => void;
}

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
  onSwapPanes,
  onFocusPane,
  onOpenTerminalTab,
  onCloseTerminalTab,
  onRenameTerminalTab,
  onMoveTerminalTab,
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
  /** Die Pane unter einem schwebenden Datei-Drag, aus welcher Quelle auch
   * immer — `null`, wenn gerade keine. `App.tsx` führt die beiden Quellen zu
   * diesem einen Wert zusammen, damit das Drop-Ziel-HUD hier nicht zwei
   * Herkünfte auseinanderhalten muss: für die Pane ist beides derselbe
   * Zustand. (Die beiden GRID-eigenen Züge — Slot-Tausch, Tab-Verschieben —
   * entstehen dagegen hier drin, s. u.) */
  dragTargetPaneId: string | null;
  onAssignProject: (slotIndex: number) => void;
  onClosePane: (paneId: string) => void;
  /** Slot-Tausch per Drag&Drop (Ticket 20) — die Geste selbst entsteht hier
   * drin (`usePaneDrag`), nach außen geht nur ihr Ergebnis. */
  onSwapPanes: (sourcePaneId: string, targetPaneId: string) => void;
  onFocusPane: (paneId: string) => void;
  onOpenTerminalTab: (paneId: string) => void;
  onCloseTerminalTab: (paneId: string, tabId: string) => void;
  /** Kontextmenü-Aktion "Umbenennen" (`PaneTabs.tsx`) — `label: null` löscht
   * den Namen wieder. */
  onRenameTerminalTab: (paneId: string, tabId: string, label: string | null) => void;
  /** Terminal-Tab in eine andere Pane desselben Projekts verschieben (Ticket
   * 32) — wie der Slot-Tausch eine hier drin entstehende Geste. */
  onMoveTerminalTab: (
    sourcePaneId: string,
    tabId: string,
    targetPaneId: string,
  ) => void;
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
  const { t } = useTranslation();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const hosts = useTerminalTabHosts();

  // Die beiden Grid-eigenen Züge (Ticket 20: Pane↔Slot am Header-Griff;
  // Ticket 32: Terminal-Tab am Chip-Griff). Ihr Zustand lebt hier und nicht
  // in App.tsx (anders als bei den Datei-Drops, deren eine Quelle außerhalb
  // dieses Baums beginnt) — Griff, Ziele und Wirkung liegen alle innerhalb
  // dieses Grids, ein Umweg über die App-Ebene brächte nur Durchreichung.
  const paneDrag = usePaneDrag<string>();
  const tabDrag = usePaneDrag<{ paneId: string; tabId: string }>();
  // Ankunfts-Quittung des Tab-Zugs: welcher Tab zuletzt per Drop angekommen
  // ist — sein Chip in der Ziel-Leiste quittiert das mit einem kurzen Wasch
  // (`PaneTabs.tsx`, `dropSettle`). `nonce` unterscheidet zwei Züge desselben
  // Tabs, damit der key-Neumount die Animation jedes Mal neu startet.
  const [dropSettle, setDropSettle] = useState<{
    tabId: string;
    nonce: number;
  } | null>(null);
  // Im Fokus-Modus ist genau eine Pane sichtbar: es gibt kein Ziel, auf das
  // man zielen könnte, und die ausgeblendeten Nachbarn behalten ihre
  // Rechtecke (`visibility: hidden`, s. u.) — ohne diese Sperre träfe die
  // Trefferprüfung Panes, die niemand sieht. Gilt für beide Züge.
  const dragEnabled = state.maximizedPaneId === null;

  const startPaneDrag =
    (paneId: string) => (event: ReactPointerEvent<HTMLElement>) => {
      if (!dragEnabled) return;
      // Die Bedienelemente im Header (Tab-Chips, Fokus-Modus, Schließen, das
      // Umbenennen-Feld) behalten ihre eigene Geste — ohne diese Ausnahme
      // begänne jeder Klick auf sie zugleich einen Zug, und die 4px-Schwelle
      // allein rettete das nur, solange die Hand ruhig bleibt.
      if (event.target instanceof Element && event.target.closest("button, input")) {
        return;
      }
      paneDrag.startDrag(event, {
        source: paneId,
        candidatePaneIds: state.slots.flatMap((slot) =>
          slot && slot.paneId !== paneId ? [slot.paneId] : [],
        ),
        onDrop: (targetPaneId) => onSwapPanes(paneId, targetPaneId),
      });
    };

  const startTabDrag =
    (pane: Pane) => (tabId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (!dragEnabled) return;
      // Der letzte verbleibende Tab lässt sich nicht wegziehen — dieselbe
      // Untergrenze wie beim Schließen (`PaneTabs.tsx`' `closable`), und der
      // Reducer wäre an dieser Stelle ohnehin ein No-Op.
      if (pane.terminalTabs.length <= 1) return;
      tabDrag.startDrag(event, {
        source: { paneId: pane.paneId, tabId },
        // Nur Panes DESSELBEN Projekts: der `cwd` einer PTY steht beim Spawn
        // fest, ein Tab in einer Pane mit anderem Projektpfad zeigte
        // dauerhaft woanders hin als seine Pane behauptet. Die Ablehnung
        // steckt in dieser Liste und wirkt damit schon beim Schweben — kein
        // HUD über einer Pane, in der ein Loslassen nichts täte.
        candidatePaneIds: state.slots.flatMap((slot) =>
          slot &&
          slot.paneId !== pane.paneId &&
          slot.projectPath === pane.projectPath
            ? [slot.paneId]
            : [],
        ),
        onDrop: (targetPaneId) => {
          onMoveTerminalTab(pane.paneId, tabId, targetPaneId);
          setDropSettle((prev) => ({ tabId, nonce: (prev?.nonce ?? 0) + 1 }));
        },
      });
    };

  // Anzeigename des gerade gezogenen Tabs für die Zeiger-Plakette
  // (`TabDragGhost`) — eigener Name oder "Terminal N", dieselbe Ableitung wie
  // der Chip selbst. `null`, sobald der Zug endet oder die Quelle während des
  // Zugs verschwindet (Pane geschlossen): dann verschwindet die Plakette mit.
  const dragSourceTab = tabDrag.source;
  const draggedTabText = (() => {
    if (dragSourceTab === null) return null;
    const sourcePane = state.slots.find(
      (slot) => slot?.paneId === dragSourceTab.paneId,
    );
    const index =
      sourcePane?.terminalTabs.findIndex(
        (tab) => tab.tabId === dragSourceTab.tabId,
      ) ?? -1;
    if (!sourcePane || index === -1) return null;
    return (
      sourcePane.terminalTabs[index]?.label ??
      t("paneTabs.terminalTab", { number: index + 1 })
    );
  })();

  const views: (PaneView | null)[] = state.slots.map((slot, index) => {
    if (!slot) return null;
    const pane = slot;
    const focused = pane.paneId === state.focusedPaneId;
    const maximized = pane.paneId === state.maximizedPaneId;
    const editor = paneFileEditors.editorFor(pane.paneId);
    // `pane.showingFile` ist reine Nutzer-ABSICHT (gridState.ts kennt keinen
    // Dateizustand) — ob dazu wirklich eine Fläche existiert, weiß nur der
    // Editor-Zustand hier. Ohne diesen Abgleich bliebe eine Pane nach einem
    // wiederhergestellten `active_tab: {kind:"file"}` auf einen inzwischen
    // ungültigen Pfad tot: FileEditor liefert bei `status === "idle"` `null`,
    // und kein Terminal-Tab wäre je sichtbar.
    const openPath = editor.state.status === "idle" ? null : editor.state.path;
    const showingFile = pane.showingFile && openPath !== null;

    return {
      pane,
      slotIndex: index,
      focused,
      maximized,
      showingFile,
      editor,
      tabs: {
        terminalTabs: pane.terminalTabs.map((tab, i) => ({
          tabId: tab.tabId,
          number: i + 1,
          label: tab.label,
        })),
        activeTerminalTabId: pane.activeTerminalTabId,
        // Grid-Fokus dieser Pane, nicht Tab-Auswahl innerhalb ihrer eigenen
        // Leiste (Begründung an PaneTabs.tsx' `paneFocused`-Feld).
        paneFocused: focused,
        showingFile,
        fileName: openPath === null ? null : fileNameFromPath(openPath),
        fileDirty: editor.wouldLoseWork,
        tabDrag: {
          start: startTabDrag(pane),
          consumeClick: tabDrag.consumeDragClick,
          draggingTabId:
            tabDrag.source?.paneId === pane.paneId
              ? tabDrag.source.tabId
              : null,
          // Nur was auch wandern könnte, kündigt sich als Griff an.
          draggable: dragEnabled && pane.terminalTabs.length > 1,
        },
        // Schwebt der Tab-Zug über DIESER Pane, zeigt ihre Leiste den
        // Platzhalter-Chip am Einfügeort — `moveTerminalTab` hängt ans Ende
        // an, der Neuzugang bekäme also die nächste freie Nummer.
        incomingTabNumber:
          tabDrag.targetPaneId === pane.paneId
            ? pane.terminalTabs.length + 1
            : null,
        dropSettle,
        onSelectTerminalTab: (tabId) =>
          onSwitchToTerminalTab(pane.paneId, tabId),
        onOpenTerminalTab: () => onOpenTerminalTab(pane.paneId),
        onCloseTerminalTab: (tabId) => onCloseTerminalTab(pane.paneId, tabId),
        onRenameTerminalTab: (tabId, label) =>
          onRenameTerminalTab(pane.paneId, tabId, label),
        onSelectFile: () => onSwitchToFileTab(pane.paneId),
      },
      // Rotations-Cluster des Fokus-Modus (Ticket 19) — EINMAL pro Zelle
      // berechnet und identisch an TerminalPane.tsx UND FileEditor.tsx
      // gereicht (Begründung/Platzierung im Pane-Header statt als
      // freischwebendes Overlay: FocusModeHud.tsx-Kopfkommentar). `null` für
      // jede nicht-maximierte Zelle — beide Flächen rendern dann einfach
      // nichts an der Stelle.
      focusModeHud: maximized ? (
        <FocusModeHud
          slotNumber={index + 1}
          totalSlots={state.slots.length}
          rotation={rotation}
        />
      ) : null,
      // Welcher der beiden Grid-eigenen Züge diese Zelle betrifft — sie
      // schließen einander aus, ein Zeiger zieht immer nur eines von beidem.
      // Seit der Politur-Runde (Nutzer-Befund "er muss mir natürlich auch
      // anzeigen, wo ich ihn jetzt loslassen könnte") zweistufig: JEDE
      // gültige Ziel-Pane trägt das Instrument ab dem Scharfwerden des Zugs
      // (gedämpfte Ecken, `engaged={false}`), die Pane unterm Zeiger spricht
      // voll samt Plakette. Die Kandidatenliste kommt aus dem Zug selbst
      // (`usePaneDrag.candidatePaneIds`) — exakt die Ausschluss-Logik, die
      // auch die Trefferprüfung benutzt, keine zweite Herleitung.
      dropInvite: tabDrag.candidatePaneIds.includes(pane.paneId) ? (
        <PaneDropInvite
          glyph="⇥"
          label={t("paneDrag.moveTabInvite")}
          engaged={tabDrag.targetPaneId === pane.paneId}
        />
      ) : paneDrag.candidatePaneIds.includes(pane.paneId) ? (
        <PaneDropInvite
          glyph="⇄"
          label={t("paneDrag.swapInvite")}
          engaged={paneDrag.targetPaneId === pane.paneId}
        />
      ) : null,
      dragSource: paneDrag.source === pane.paneId,
      fileDropTarget: pane.paneId === dragTargetPaneId,
      onHeaderPointerDown: startPaneDrag(pane.paneId),
      // Derselbe Header-Knopf ist Ein- und Ausstieg zugleich: eine maximierte
      // Pane bietet "verlassen" an, jede andere "maximieren" — zwei
      // Aktionen, aber immer nur EIN sichtbarer Knopf pro Zelle.
      onToggleFocusMode: () =>
        maximized ? onExitFocusMode() : onEnterFocusMode(pane.paneId),
      onClose: () => onClosePane(pane.paneId),
      onFocus: () => onFocusPane(pane.paneId),
    };
  });

  // Wer besitzt gerade welchen Tab — die einzige Eingabe des Umhängens.
  const ownership: TabOwnership[] = views.flatMap((view) =>
    view === null
      ? []
      : view.pane.terminalTabs.map((tab) => ({
          tabId: tab.tabId,
          paneId: view.pane.paneId,
        })),
  );
  // LAYOUT-Effekt, nicht passiv, und bewusst ohne Dependency-Array (wie
  // useGridTransitions.ts): alle Layout-Effekte laufen vor allen passiven,
  // der Container hängt dadurch garantiert im Dokument, bevor
  // `usePtyTerminal`s Mount-Effekt `terminal.open()`/`fitAddon.fit()` ruft —
  // in einem noch nicht eingehängten Container misst der FitAddon 0×0.
  // `syncOwnership` ist idempotent, ein Lauf pro Commit kostet nichts.
  useLayoutEffect(() => {
    hosts.syncOwnership(ownership);
  });

  // Weiche Übergänge für Template-Wechsel, Fokus-Modus und Slot-Tausch (FLIP,
  // s. useGridTransitions.ts) — reine WAAPI-Animationen auf den bestehenden
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
    <>
    {/* Der Template-Wechsel ändert GENAU DIESE Klasse und sonst nichts am Baum
        — Spuren und Spannen aller sieben Geometrien stehen in App.css
        (`.pc-layout--*`), die Begründung dafür ebenfalls dort. Der Fokus-Modus
        ist orthogonal dazu (`gridState.ts`s Kopfkommentar zu
        `maximizedPaneId`): das Template bleibt unverändert stehen, nur EINE
        Zelle wird per `grid-area`-Inline-Style auf das ganze Raster gespannt
        (s. u.) — kein Unmount, keine zweite Layout-Klasse nötig. */}
    <div ref={workspaceRef} className={`pc-workspace pc-layout--${state.template}`}>
      {views.map((view, index) =>
        view ? (
          <PaneCell
            key={view.pane.paneId}
            view={view}
            focusModeActive={state.maximizedPaneId !== null}
            hostRef={hosts.hostRef(view.pane.paneId)}
            guardLeave={guardLeave}
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
      {/* NACH den Zellen: Portale rendern zwar kein DOM an dieser Stelle,
          aber ihre Kinder mounten in Baumreihenfolge — die Host-Flächen der
          Zellen sind dadurch schon per Ref eingetragen, wenn der Layout-
          Effekt oben die Container einhängt. */}
      {views.flatMap((view) =>
        view === null
          ? []
          : view.pane.terminalTabs.map((tab) =>
              createPortal(
                <TerminalTabSurface
                  view={view}
                  tabId={tab.tabId}
                  dropTargets={dropTargets}
                />,
                hosts.containerFor(tab.tabId),
                tab.tabId,
              ),
            ),
      )}
    </div>
    {/* Die Zeiger-Plakette des Tab-Zugs — `fixed`, entkommt also der
        Grid-Geometrie; hier statt in App.tsx gerendert, weil der Zug
        vollständig in diesem Baum lebt (s. Kommentar an `usePaneDrag` oben).
        Bewusst als GESCHWISTER des Arbeitsraums, nicht als sein Kind: die
        `.pc-workspace > *`-Regeln (App.css) gelten jedem direkten Kind — die
        `pc-cell-in`-Mount-Animation überschriebe mit ihren transform-
        Keyframes 200ms lang genau das Inline-`translate3d`, über das der
        Zieh-Hook die Plakette führt (und die Kinderliste des Arbeitsraums
        bleibt so exakt die Slot-Liste, `useGridTransitions`' positionsweise
        Zuordnung eingeschlossen). Als `position: fixed` nimmt sie am Layout
        des Elternteils ohnehin nicht teil. Der Slot-Tausch braucht kein
        Pendant: dort tritt die ganze gezogene Zelle sichtbar zurück
        (opacity-50, `PaneCell`), die Quelle selbst IST das "in der
        Hand"-Signal. */}
    {draggedTabText !== null && tabDrag.ghostOrigin !== null && (
      <TabDragGhost
        ghostRef={tabDrag.ghostRef}
        text={draggedTabText}
        origin={tabDrag.ghostOrigin}
        overTarget={tabDrag.targetPaneId !== null}
      />
    )}
    </>
  );
}

/** Eine Terminal-Tab-Fläche, gerendert ins stabile Container-`<div>` ihres
 * Tabs (Kopfkommentar) und dadurch dort, wo dessen Host-Fläche gerade hängt.
 * Alle Werte kommen aus der `PaneView` ihrer AKTUELLEN Besitzer-Pane — nach
 * einem Zug ist das eine andere, ohne dass hier etwas neu gemountet wird. */
function TerminalTabSurface({
  view,
  tabId,
  dropTargets,
}: {
  view: PaneView;
  tabId: string;
  dropTargets: PaneDropRegistration;
}) {
  const isActiveTab = tabId === view.pane.activeTerminalTabId;
  const isVisible = isActiveTab && !view.showingFile;
  return (
    // Jede Fläche bleibt gemountet, nur ausgeblendet — ein Unmount würde über
    // `usePtyTerminal`s Cleanup `pty_kill` auslösen. Deshalb NICHT `hidden`
    // (= `display: none`): ein inaktiver Tab wäre damit 0×0 groß, denn
    // `usePtyTerminal.ts`s `fitAddon.fit()` misst die Containerbox beim
    // Mount, und `display: none` nimmt sie komplett aus dem Layout. Jede
    // Fläche liegt `absolute inset-0` exakt über den anderen (Bezug ist die
    // Host-Fläche der Zelle, `PaneCell` unten) und wird nur per inline
    // `visibility: hidden` ausgeblendet — das lässt den Platz im Layout,
    // xterm.js misst also auch als inaktiver Tab korrekt, und nimmt
    // Klicks/Drops gleich mit raus, ohne ein zusätzliches
    // `pointer-events: none` zu brauchen. Inline statt Tailwind-Klasse, damit
    // es unabhängig vom geladenen Stylesheet real vorhanden ist (u. a.
    // Voraussetzung für Testing Librarys `toBeVisible()`).
    <div
      className="absolute inset-0 flex min-h-0 flex-col"
      style={isVisible ? undefined : { visibility: "hidden" }}
    >
      <TerminalPane
        paneId={view.pane.paneId}
        slotIndex={view.slotIndex}
        tabId={tabId}
        projectPath={view.pane.projectPath}
        projectName={projectNameFromPath(view.pane.projectPath)}
        focused={view.focused}
        maximized={view.maximized}
        // Unabhängig von `showingFile`: genau EIN Terminal-Tab je Pane trägt
        // die Drop-Registrierung (`useWebviewFileDrop.ts`) — korrekt an den
        // AKTIVEN von N Tabs gebunden statt zufällig an den zuletzt
        // gemounteten. Seit Ticket 32 zählt dabei die aktuelle Besitzer-Pane:
        // ein verschobener Tab meldet sich bei der alten ab und bei der neuen
        // an (Regressionstest in TerminalPane.test.tsx).
        active={isActiveTab}
        dropTarget={view.fileDropTarget}
        tabs={view.tabs}
        dropTargets={dropTargets}
        onClose={view.onClose}
        onFocus={view.onFocus}
        onHeaderPointerDown={view.onHeaderPointerDown}
        onToggleFocusMode={view.onToggleFocusMode}
        focusModeHud={view.focusModeHud}
      />
    </div>
  );
}

function PaneCell({
  view,
  focusModeActive,
  hostRef,
  guardLeave,
}: {
  view: PaneView;
  /** Ob IRGENDEINE Pane gerade maximiert ist — auch für die anderen Zellen
   * relevant, die dann `visibility: hidden` bekommen statt ihrer normalen
   * Sichtbarkeit. */
  focusModeActive: boolean;
  /** Ref-Callback für die Host-Fläche der Terminal-Tabs dieser Pane
   * (`useTerminalTabHosts.ts`). React legt in diesen Knoten nie selbst etwas
   * hinein — seine Kinder sind die stabilen Tab-Container. */
  hostRef: (element: HTMLDivElement | null) => void;
  guardLeave: (paneId: string, run: () => void) => void;
}) {
  const { pane, focused, maximized, showingFile, editor } = view;

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
  // exakt der Grund, warum schon die Terminal-Tab-Sichtbarkeit
  // (`TerminalTabSurface` oben) dasselbe Muster verwendet. Ohne diesen
  // Unterschied verlöre `fitAddon.fit()` beim Verlassen des Fokus-Modus seine
  // Messbasis. Dasselbe gilt für leere Slots (`ProjectPicker.tsx`s eigene
  // `focusModeActive`-Prop).
  const cellStyle: CSSProperties | undefined = maximized
    ? { position: "absolute", inset: 0, zIndex: 30 }
    : focusModeActive
      ? { visibility: "hidden" }
      : undefined;

  return (
    // `relative`, damit die absolut positionierten Flächen darunter (die
    // Terminal-Host-Fläche UND der File-Tab) sich exakt auf DIESE Zelle
    // beziehen, nicht auf das ganze Grid.
    <div
      // Die gezogene Pane tritt zurück (Ticket 20) — ohne diesen Unterschied
      // sähen Quelle und Ziel während des Zugs identisch aus, und das
      // Ziel-HUD wäre das einzige Signal, dass überhaupt etwas gezogen wird.
      className={`relative flex min-h-0 min-w-0 flex-col transition-opacity ${
        view.dragSource ? "opacity-50" : ""
      }`}
      style={cellStyle}
    >
      {/* Die Host-Fläche der Terminal-Tabs dieser Pane: React rendert genau
          dieses eine, leere `<div>` und rührt seinen Inhalt nie an — die
          Tab-Container hängt `useTerminalTabHosts.ts` per DOM hinein. Genau
          diese Trennung ist der Grund, warum ein Tab die Pane wechseln kann,
          ohne unmountet zu werden. */}
      <div ref={hostRef} className="absolute inset-0" />
      <div
        className="absolute inset-0 flex min-h-0 flex-col"
        style={showingFile ? undefined : { visibility: "hidden" }}
      >
        <FileEditor
          state={editor.state}
          focused={focused}
          maximized={maximized}
          projectName={projectNameFromPath(pane.projectPath)}
          tabs={view.tabs}
          onEdit={editor.editContent}
          onSave={editor.save}
          onClose={() => guardLeave(pane.paneId, editor.close)}
          onHeaderPointerDown={view.onHeaderPointerDown}
          onToggleFocusMode={view.onToggleFocusMode}
          focusModeHud={view.focusModeHud}
        />
      </div>
      {/* Zuletzt im Zellen-Array und damit über allen Flächen darin: das HUD
          des Grid-eigenen Zugs gehört der ganzen Zelle, nicht dem gerade
          sichtbaren Tab. */}
      {view.dropInvite}
    </div>
  );
}
