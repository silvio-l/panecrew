/*
 * DIRECTION CONTRACT — PaneCrew Desktop-Hauptoberfläche
 * (Quelle: .impeccable/direction-contract-desktop.md, Stand 2026-08-04 nach
 * Comp-Konsolidierung. Mode: Operate. Canon-Pfad, vom Nutzer gepinnt.)
 *
 * THESIS: The screen belongs to the terminals. Chrome exists only to answer
 * two questions — which project is this pane, and which pane is live. Refuses
 * the editor-shell-with-terminal-drawer default.
 *
 * OWN-WORLD: the reference editor's token grammar — warm-dark grounds (#1E1E1E family),
 * 1px hairline borders, 13px system-UI chrome type, ui-monospace terminal
 * text — softened by modern-terminal polish: gentle pane radii, relaxed terminal
 * line-height, one accent reserved exclusively for focus. (The contract wrote
 * that accent as blue; the user moved it to the brand's amber on 2026-08-05 —
 * derivation in theme.css above --pc-focusBorder.)
 *
 * STORY: Launch, and everything is already in place. One glance finds the
 * focused pane; the explorer is always showing that pane's project — never
 * the wrong files.
 *
 * FIRST VIEWPORT: 2×2 grid of live terminals owning the clear majority of the
 * window; on the left a compact, permanently visible explorer panel — the
 * file tree directly, no icon rail, no overlay — styled 1:1 after the reference editor's
 * current explorer (folder chevrons, type-colored file icons, muted tree
 * foreground with brighter active entry); a slim workbench-style title bar
 * (macOS titleBarStyle Overlay — native traffic lights kept, left padding
 * reserved for them, drag region) with app identity left, a centered
 * non-functional command-palette/search placeholder ("Suchen oder Befehl
 * ausführen" — visual only, future feature) and the settings access on its
 * right side; per-pane header a
 * single slim text line (24px-plus click target, no thick bar) carrying the
 * project name; the single accent traces the focused pane's border and echoes
 * in the explorer's project header. (The contract wrote that border as a
 * luminous glow, comp-2 material quality — the user revoked their own approval
 * of the glow on 2026-08-05; the accent border alone carries the focus now.)
 *
 * FORM: Canon path, user-pinned (workbench grammar, terminal warmth); no seed
 * rolled. Comp-Konsolidierung (Nutzer-Freigabe 2026-08-04): Optik/Material
 * aus mocks/comp-2-overlay-explorer.png, Explorer-Struktur und dünne
 * Pane-Header aus mocks/comp-3-zero-chrome.png.
 *
 * STAND TICKET 03: Das 2x2-Raster des FIRST VIEWPORT steht — mit echten,
 * PTY-gestützten Panes, und als Default unter sieben wählbaren Geometrien
 * (Geometrie in App.css, Slot-Zahl in grid/gridState.ts). Der Akzent trägt
 * jetzt tatsächlich nur EINE Pane: den Rahmen der fokussierten.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { Tooltip } from "radix-ui";
import { Trans, useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { TITLE_BAR_ZONE_HEIGHT, TitleBar } from "./components/TitleBar";
import { CollapsedExplorerStrip, ExplorerPanel } from "./components/ExplorerPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { FocusPinHeader } from "./components/FocusPinHeader";
import { FocusTrace } from "./components/FocusTrace";
import { GridStatusRail } from "./components/GridStatusRail";
import { PaneGrid } from "./components/PaneGrid";
import { PathDragGhost } from "./components/PathDragGhost";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { ShortcutsReferenceDialog } from "./components/ShortcutsReferenceDialog";
import { TemplateSwitcher } from "./components/TemplateSwitcher";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { UpdateBanner } from "./updater/UpdateBanner";
import {
  fileNameFromPath,
  isPathOrDescendant,
  remapRenamedPath,
} from "./explorer/filePath";
import { usePaneFileEditors } from "./explorer/usePaneFileEditors";
import {
  applyPausedEvent,
  applySingleKillEvent,
  applyStatusEvent,
  applyTerminatedEvent,
  disposeResourceGuardEntry,
} from "./terminal/resourceGuard";
import {
  activePanes,
  firstEmptySlotIndex,
  focusedProjectPath,
  GRID_TEMPLATES,
  nextGrowthTemplate,
  nextPaneId,
  templateSwitchBlockReason,
  trackShape,
} from "./grid/gridState";
import { useFocusRotation } from "./grid/useFocusRotation";
import { useGrid } from "./grid/useGrid";
import {
  getOnboardingState,
  setOnboardingCompleted,
  setOnboardingWizardCompleted,
  subscribeToOnboardingChanges,
} from "./onboarding/onboarding";
import {
  onboardingHintSlot as deriveOnboardingHintSlot,
  onboardingHintVariant,
  onboardingShouldComplete,
} from "./onboarding/onboardingState";
import { OnboardingHint } from "./onboarding/OnboardingHint";
import { OnboardingFloatingHint } from "./onboarding/OnboardingFloatingHint";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import { useProjects } from "./projects/useProjects";
import { projectNameFromPath } from "./types/project";
import {
  buildWindowState,
  restoredSlots,
  restoredSplitRatios,
  restoredTemplate,
  withRecentProject,
  withoutRecentProject,
} from "./session/sessionState";
import { normalizeRatios } from "./grid/splitRatios";
import { loadSession, saveSessionWindow } from "./session/sessionStore";
import { windowIdentity } from "./window/useWindowIdentity";
import { info } from "./logging/log";
import { isMacPlatform } from "./shortcuts/platform";
import {
  matchesShortcut,
  SHORTCUTS,
  terminalTabSelectNumber,
  TOGGLE_FOCUS_MODE_SHORTCUT_ID,
} from "./shortcuts/registry";
import { useAppZoom } from "./shortcuts/useAppZoom";
import { useNewWindowShortcut } from "./shortcuts/useNewWindowShortcut";
import { useSearchInFilesShortcut } from "./shortcuts/useSearchInFilesShortcut";
import { useSplitPaneShortcut } from "./shortcuts/useSplitPaneShortcut";
import { useExplorerPathDrag } from "./terminal/useExplorerPathDrag";
import { useWebviewFileDrop } from "./terminal/useWebviewFileDrop";
import "./App.css";

const EXPLORER_MIN_WIDTH = 180;
const EXPLORER_MAX_WIDTH = 480;
const EXPLORER_DEFAULT_WIDTH = 224;

function App() {
  const { t } = useTranslation();
  // Destrukturiert wie `useProjects()`s Rückgabe: `assignProject`/
  // `closePane` sind in `useGrid.ts` per `useCallback` memoisiert, ein
  // `grid`-Objekt als Ganzes wäre dagegen bei jedem Render neu und risse
  // jeden `useEffect`, der eine der beiden Funktionen aufruft, mit sich.
  const {
    state: gridState,
    assignProject,
    closePane,
    swapPanes,
    movePaneToEmptySlot,
    switchTemplate,
    focusPane,
    openTerminalTab,
    closeTerminalTab,
    moveTerminalTab,
    moveTerminalTabToEmptySlot,
    renameTerminalTab,
    switchToTerminalTab,
    switchToFileTab,
    enterFocusMode,
    exitFocusMode,
    focusModeSelectSlot,
    setSplitRatios,
  } = useGrid();
  // Ticket 27: natives Tauri-Fensterlabel + ob dies "main" ist — ändert sich
  // nie über die Lebenszeit des Fensters (`useWindowIdentity.ts`), deshalb
  // per Lazy-`useState`-Initializer statt jeden Render neu gelesen.
  const [windowId] = useState(windowIdentity);
  // `null`, solange keine Pane fokussiert ist (z. B. alle Slots leer beim
  // ersten Start) — jede Stelle unten, die eine `paneId` braucht, behandelt
  // das explizit, statt eine Pane vorzutäuschen, die es nicht gibt.
  const focusedPaneId = gridState.focusedPaneId;
  const focusedPath = focusedProjectPath(gridState);
  // Rotationsmodus (Ticket 19) — reine Zustandsverwaltung im Hook, `App.tsx`
  // liefert nur, WOHIN reihum weitergeschaltet wird, und WAS ein
  // Rotationsschritt tut. Rotationseinheit ist der Terminal-TAB, nicht die
  // Pane (Nutzer-Korrektur 2026-08-13): die Sequenz geht Pane für Pane in
  // Slot-Reihenfolge, innerhalb jeder Pane aber erst ihre Tabs 1..N durch,
  // bevor sie zur nächsten Pane weiterschaltet — ein Rotationsschritt ist
  // deshalb immer BEIDES zugleich, "maximiere diese Pane" (`enterFocusMode`,
  // No-Op wenn schon maximiert) UND "zeige diesen ihrer Tabs"
  // (`switchToTerminalTab`).
  const maximizedPane = activePanes(gridState).find(
    (pane) => pane.paneId === gridState.maximizedPaneId,
  );
  const focusRotation = useFocusRotation({
    maximizedPaneId: gridState.maximizedPaneId,
    activeTabId: maximizedPane?.activeTerminalTabId ?? null,
    occupiedPanesInOrder: activePanes(gridState).map((pane) => ({
      paneId: pane.paneId,
      tabIds: pane.terminalTabs.map((tab) => tab.tabId),
    })),
    onRotate: (next) => {
      enterFocusMode(next.paneId);
      switchToTerminalTab(next.paneId, next.tabId);
    },
  });
  const notifyRotationInput = focusRotation.notifyInput;

  // Titelleisten-Pfeile (Ticket pane-navigation-titlebar/01+02): dieselbe
  // Reihenfolge wie die Zahlen-Hotkeys 1–4 (`nextPaneId` traversiert
  // `activePanes`, die kompaktierte, belegte Teilmenge des rohen
  // `slots`-Arrays, das auch die Hotkeys indizieren — für belegte Slots
  // dieselbe Reihenfolge). Im Fokus-Modus wechselt der Klick
  // `maximizedPaneId` weiter (wie ein Zahlen-Hotkey), sonst nur den
  // Grid-Fokus. `notifyRotationInput()` explizit statt sich auf den
  // Capture-Phase-`pointerdown`-Listener unten zu verlassen: der feuert bei
  // einem echten Klick zwar mit, in Tests (`fireEvent.click`) aber nicht von
  // selbst — Ticket 02 verlangt den vollständigen Rotationsstopp bei jedem
  // Klick auf einen der Pfeile, nicht nur "meistens".
  const navigatePane = (direction: "next" | "previous") => {
    notifyRotationInput();
    const panes = activePanes(gridState);
    if (gridState.maximizedPaneId !== null) {
      const target = nextPaneId(panes, gridState.maximizedPaneId, direction);
      if (target !== null) enterFocusMode(target);
      return;
    }
    const target = nextPaneId(panes, focusedPaneId, direction);
    if (target !== null) focusPane(target);
  };

  // Fokus-Modus-Kürzel (Ticket 19) — EIN Fenster-Listener statt drei
  // verstreuten, weil alle drei dieselbe Reihenfolgefrage gegen
  // `usePtyTerminal.ts`s Pane-Kürzel klären müssen: die Capture-Phase
  // (drittes `addEventListener`-Argument `true`) lässt diesen Listener VOR
  // dem xterm-eigenen `attachCustomKeyEventHandler` laufen (der hängt am
  // versteckten Textarea-Element der jeweiligen Pane, tiefer im Baum als
  // `window`) — `stopPropagation()` verhindert dort zuverlässig eine zweite,
  // widersprüchliche Reaktion (Cmd+Return z. B. dürfte niemals zusätzlich als
  // \r bei der Shell ankommen). `useAppZoom.ts`s Listener daneben braucht das
  // nicht (reine App-Kürzel ohne Pane-Gegenstück), dieser hier schon.
  useEffect(() => {
    const isMac = isMacPlatform();

    const onKeyDown = (event: KeyboardEvent) => {
      notifyRotationInput();

      const toggleShortcut = SHORTCUTS.find(
        (def) =>
          def.id === TOGGLE_FOCUS_MODE_SHORTCUT_ID &&
          matchesShortcut(event, def, isMac),
      );
      if (toggleShortcut) {
        event.preventDefault();
        event.stopPropagation();
        if (gridState.maximizedPaneId !== null) exitFocusMode();
        else if (focusedPaneId !== null) enterFocusMode(focusedPaneId);
        return;
      }

      if (gridState.maximizedPaneId === null) return;

      if (event.key === "Escape") {
        event.preventDefault();
        exitFocusMode();
        return;
      }

      // Zahlen-Hotkeys wählen im Fokus-Modus eine ANDERE Pane an statt (wie
      // sonst) einen Terminal-Tab der aktiven — dieselben Kürzel-Definitionen
      // wie `usePtyTerminal.ts`, nur mit umgedeuteter Wirkung, deshalb hier
      // abgefangen, bevor sie dort ankommen.
      const digitShortcut = SHORTCUTS.find(
        (def) =>
          matchesShortcut(event, def, isMac) &&
          terminalTabSelectNumber(def) !== null,
      );
      const slotNumber = digitShortcut
        ? terminalTabSelectNumber(digitShortcut)
        : null;
      if (slotNumber !== null) {
        event.preventDefault();
        event.stopPropagation();
        focusModeSelectSlot(slotNumber - 1);
      }
    };
    const onPointerDown = () => notifyRotationInput();

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [
    gridState.maximizedPaneId,
    focusedPaneId,
    enterFocusMode,
    exitFocusMode,
    focusModeSelectSlot,
    notifyRotationInput,
  ]);
  // Destrukturiert statt als `projects`-Objekt weitergereicht: `load`/
  // `refresh` sind eigene, stabile Bindungen (in `useProjects.ts` per
  // `useCallback` memoisiert) — das hält sie aus `useEffect`-Dep-Arrays
  // heraus, die sonst bei jeder Cache-Änderung neu feuern würden.
  const {
    projects: projectRecords,
    load: loadProject,
    refresh: refreshProject,
    loadChildren: loadExplorerChildren,
  } = useProjects();
  // `project` ist abgeleitet, kein eigener State: die schwere `Project`-
  // Struktur (Baum, Git-Deko) lebt im pfad-geschlüsselten Cache, hier steht
  // nur noch, welches Projekt die fokussierte Pane gerade zeigt — der
  // Explorer bindet auf GENAU dieses Projekt.
  const project =
    focusedPath !== null ? (projectRecords[focusedPath] ?? null) : null;
  const [selectedFile, setSelectedFile] = useState<Record<string, string>>({});
  // AUFgeklappte Ordner je Projektpfad (nicht je Pane) — dieselbe
  // Schlüsselung wie `session.json`s `expanded_folders` und wie der
  // Live-Zustand selbst: `ExplorerPanel` hängt an `project.path`
  // (`key={project.path}` unten), nicht an einer `paneId`. Ein fehlender
  // Eintrag heißt "nichts weicht vom Default ab" — `ExplorerPanel` bleibt dann
  // bei ihrem eigenen Alles-eingeklappt-Default.
  const [expandedFolders, setExpandedFolders] = useState<Record<string, string[]>>({});
  // App-weite Liste zuletzt geöffneter Projekte (Ticket 22), zuletzt zuerst —
  // wie `expandedFolders`/`explorerWidth` ein window-agnostischer Global, der
  // über `saveSessionWindow`s Globals-Kanal mitläuft statt eine eigene
  // Persistenz-Anbindung zu brauchen.
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const recordRecentProject = (path: string) =>
    setRecentProjects((current) => withRecentProject(current, path));
  // `null` = noch nicht geladen (Backend-Roundtrip läuft), `true`/`false` der
  // reale Stand aus `onboarding.json`. Der Hinweis zeigt sich NIE während
  // `null` — sonst blitzte er bei jedem Start kurz auf, bevor der geladene
  // Stand ihn wieder wegnimmt.
  const [onboardingCompleted, setOnboardingCompletedState] = useState<boolean | null>(null);
  // Phase 1 (Initial-Setup-Wizard) — same "`null` = not loaded yet, never
  // show during `null`" convention as `onboardingCompleted` above.
  const [wizardCompleted, setWizardCompletedState] = useState<boolean | null>(null);
  // Welcher leere Slot gerade auf den (modalen) Ordner-Dialog wartet —
  // `null`, wenn keiner. Ersetzt das frühere App-weite `picking`: mit
  // mehreren leeren Slots braucht der Busy-Zustand ein Ziel.
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  // Sperrt das Auto-Save weiter unten, bis die Wiederherstellung (Sitzung +
  // CLI-Startprojekt) selbst einmal durchgelaufen ist — ohne die Sperre würde
  // der allererste Render (leeres Quad, noch bevor `session.json` gelesen
  // ist) sofort über sich selbst geschrieben und die eben geladene Sitzung
  // sofort wieder löschen.
  const [hydrated, setHydrated] = useState(false);
  // Slot-Indizes, die die wiederhergestellte Sitzung noch befüllen will —
  // ihr Picker zeigt bis dahin einen Ladehinweis statt eines klickbaren
  // Knopfs, sonst könnte ein Klick währenddessen mit `restoreSlot` unten um
  // denselben Slot konkurrieren. Immer leer, sobald `hydrated` kippt.
  const [restoringSlots, setRestoringSlots] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT_WIDTH);
  // Persistierter Nachfolger von `explorerWidth`: wie `explorerWidth` selbst
  // (s. `explorerContainerRef` unten) nur am Ende eines Drags (pointerup)
  // bzw. je Tastendruck aktualisiert, nie während des Ziehens selbst —
  // `session_save` schreibt über einen einzigen Prozess-Temp-Pfad + atomarem
  // Rename, überlappende Aufrufe würden sich gegenseitig die Datei
  // zerschießen. Die einzige Breite, die `buildSessionState` sieht.
  const [persistedExplorerWidth, setPersistedExplorerWidth] = useState(
    EXPLORER_DEFAULT_WIDTH,
  );
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [resizingExplorer, setResizingExplorer] = useState(false);
  // Gemessen (Render-Kosten-Audit, `.scratch/`-Session 2026-08-16): ein
  // 30-Schritt-Pointermove-Drag über `setExplorerWidth` löste 31 volle
  // `PaneGrid`-Commits und 155 `TerminalPane`-Commits aus — der gesamte
  // Pane-Baum reconciled bei jedem Pixel, obwohl `explorerWidth` dort gar
  // nicht ankommt (nur `ExplorerPanel` liest die Prop). Dieser Ref trägt die
  // Breite deshalb WÄHREND des Ziehens direkt als CSS-Custom-Property auf
  // einen gemeinsamen Vorfahren von Separator und `<aside>` auf (kein
  // React-Re-Render pro `pointermove`) — `ExplorerPanel.tsx`s `style={{width}}`
  // löst sie per `var(--pc-explorer-live-width, ${width}px)` auf, der
  // Explorer folgt dem Zeiger also weiterhin jeden Frame, nur ohne dafür
  // `PaneGrid` mitzureißen. `explorerWidth` selbst committet erst bei
  // `pointerup` (Tastatur-Nudge bleibt unverändert synchron).
  const explorerContainerRef = useRef<HTMLDivElement>(null);
  // Räumt die Live-Override auf, sobald der committete Wert sie eingeholt
  // hat — `useLayoutEffect` statt `useEffect`, damit das VOR dem nächsten
  // Paint passiert (kein sichtbares Zurückspringen auf den alten `width`-
  // Fallback für einen Frame, bevor der neue Commit sichtbar wird).
  useLayoutEffect(() => {
    explorerContainerRef.current?.style.removeProperty(
      "--pc-explorer-live-width",
    );
  }, [explorerWidth]);
  // Liest Baum + Git-Status des von der fokussierten Pane gezeigten Projekts
  // neu, ohne die offene Dateiauswahl anzutasten (anders als ein
  // Projektwechsel).
  //
  // Steht vor `usePaneFileEditors`, weil der Hook es als `onSaved` bekommt und
  // ein späteres `const` hier in seiner temporalen Totzone läge.
  const refreshExplorer = () => {
    if (focusedPath === null) return;
    void refreshProject(focusedPath);
  };

  // Nach jedem erfolgreichen Schreiben Baum und Git-Deko neu lesen — sonst
  // stünde die Deko der eben gespeicherten Datei veraltet da: aus einer
  // unveränderten versionierten Datei macht genau dieses Schreiben ein „M".
  const paneFileEditors = usePaneFileEditors(refreshExplorer);

  // `.scratch/explorer-live-refresh`: beobachtet das Projektverzeichnis der
  // fokussierten Pane und ruft bei Änderungen denselben `refreshExplorer`-
  // Pfad wie der manuelle Aktualisieren-Button — Expanded-State-Erhalt kommt
  // dadurch kostenlos mit. `focusedPath` ist bereits exakt `project?.path`
  // (siehe `focusedProjectPath`), ein Wechsel zwischen zwei Panes auf
  // demselben Projekt ändert diesen Wert also nicht — die Rust-Seite behandelt
  // den identischen Pfad ohnehin als No-op, unabhängig davon.
  useEffect(() => {
    if (focusedPath === null) return;
    const path = focusedPath;
    void invoke("explorer_watch_start", { path }).catch(() => {
      // Best-effort: ein fehlendes/unlesbares Root lässt den Explorer ohne
      // Live-Updates zurück, genau wie vor diesem Feature — der manuelle
      // Button funktioniert unverändert weiter.
    });
    const unlistenPromise = listen("explorer:changed", () => refreshExplorer());
    return () => {
      void invoke("explorer_watch_stop");
      void unlistenPromise.then((unlisten) => unlisten());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `refreshExplorer` schließt `focusedPath` bereits über dieselbe Abhängigkeit ein, ein Re-Run bei jeder Neudefinition wäre nur Start/Stop-Lärm ohne Verhaltensänderung.
  }, [focusedPath]);

  // Pro-Tab-Ressourcen-Eskalationskette (`resource_guard.rs`): einmalig pro
  // Fensterlebensdauer registriert, genau wie `explorer:changed` oben — die
  // vier Events landen zentral hier und werden nur ins modul-globale
  // `resourceGuard.ts`-Register geschrieben, nicht direkt in Komponenten-
  // Zustand. `PaneTabs.tsx`s Warn-Chip und `TerminalPane.tsx`s Pause-/
  // Terminated-Banner lesen dieses Register selbst über `useTabResourceGuard`.
  useEffect(() => {
    const unlistenPromises = [
      listen<{ tabId: string; status: "normal" | "warn"; percent: number }>(
        "pty:tab-resource-status",
        (event) => applyStatusEvent(event.payload),
      ),
      listen<{ tabId: string; percent: number; pid: number }>("pty:tab-paused", (event) =>
        applyPausedEvent(event.payload),
      ),
      listen<{ tabId: string; percent: number }>("pty:tab-single-kill", (event) =>
        applySingleKillEvent(event.payload),
      ),
      listen<{ tabId: string; percent: number; reason: string }>(
        "pty:tab-terminated",
        (event) => applyTerminatedEvent(event.payload),
      ),
    ];
    return () => {
      for (const unlistenPromise of unlistenPromises) {
        void unlistenPromise.then((unlisten) => unlisten());
      }
    };
  }, []);

  // Der Editor der fokussierten Pane — das Rechteck der Editorfläche zeigt
  // immer nur sie. Ohne fokussierte Pane (leeres Grid) liest `editorFor("")`
  // denselben `IDLE_STATE` wie jede unbenutzte `paneId` — kein Sonderfall
  // nötig.
  const fileEditor = paneFileEditors.editorFor(focusedPaneId ?? "");
  const zoom = useAppZoom();
  useNewWindowShortcut();
  // Cmd/Ctrl+Shift+F: klappt einen eingeklappten Explorer wieder auf und
  // stößt sein Öffnen-plus-Fokussieren über einen reinen Nonce an (s.
  // `openSearchSignal`-Prop-Doku in ExplorerPanel.tsx) — nichts davon
  // überlebt einen Projektwechsel absichtlich, `ExplorerPanel` bekommt bei
  // jedem ohnehin einen frischen `key`.
  const [openSearchSignal, setOpenSearchSignal] = useState(0);
  useSearchInFilesShortcut(
    useCallback(() => {
      setExplorerCollapsed(false);
      setOpenSearchSignal((current) => current + 1);
    }, []),
  );
  // Dritter der zehn Referenz-Editor-Menüaudit-Punkte: "Pane teilen"
  // (Ctrl/Cmd+Shift+5). PaneCrews Raster kennt kein "diese eine Pane
  // aufteilen" — nur Layout-Vorlagen mit fester Slot-Zahl (`gridState.ts`).
  // Interpretiert als: zur nächstgrößeren Vorlage wachsen
  // (`nextGrowthTemplate`, wächst dabei immer um genau einen Slot, s. dessen
  // Doku) und den neu entstandenen leeren Slot sofort mit dem Projekt der
  // gerade fokussierten Pane belegen — fühlt sich dadurch wie ein echtes
  // Teilen dieser einen Pane an, nicht wie ein bloßes Aufdecken eines freien
  // Feldes irgendwo im Raster. `assignProject` setzt `focusedPaneId` selbst
  // auf die neue Pane (s. dessen Doku in useGrid.ts) — dieselbe
  // Fokus-folgt-der-neuen-Pane-Erwartung wie beim Referenz-Editor. Kein
  // Kandidat mehr (bereits an der Obergrenze, oder keine Pane fokussiert):
  // stilles No-Op, dieselbe Haltung wie `resolveMenuTargetSlot` oben.
  const splitFocusedPane = useCallback(() => {
    if (focusedPaneId === null) return;
    const projectPath = focusedProjectPath(gridState);
    if (projectPath === null) return;
    const target = nextGrowthTemplate(gridState.template);
    if (target === null) return;
    const newSlotIndex = gridState.slots.length;
    switchTemplate(target);
    assignProject(newSlotIndex, projectPath);
  }, [focusedPaneId, gridState, switchTemplate, assignProject]);
  useSplitPaneShortcut(splitFocusedPane);
  // Die EINE Drop-Registrierung des Grids. Sie stand bis zum Explorer-Ziehen
  // in `PaneGrid.tsx` — mit einer zweiten Drop-QUELLE, die im Explorer
  // beginnt (einem Geschwister von `PaneGrid`, nicht einem Kind), muss sie
  // über beiden liegen. Ihre Einzigkeit ist dabei nicht bloß Aufräumen,
  // sondern Bedingung: die Registrierung ordnet Drops Panes zu, zwei
  // Instanzen führten zwei unvollständige Listen.
  const { dropTargets, dragTargetPaneId } = useWebviewFileDrop(zoom);
  // Die zweite Quelle: Ziehen aus dem Explorer. Eigener Zustand fürs HUD,
  // aber dieselbe Registrierung als Ziel — ein Pfad, der im Terminal landet,
  // nimmt ab dort denselben Weg wie ein Drop aus dem Finder.
  const explorerDrag = useExplorerPathDrag(dropTargets);

  // Halbes Freigabesignal für das Hauptfenster: es startet unsichtbar hinter dem
  // Splash und darf erst aufgedeckt werden, wenn hier etwas zu sehen ist. Rust
  // wartet zusätzlich auf das Ende des Splash-Videos.
  useEffect(() => {
    // Ticket 27, landmine 4: `main_ready`/`get_launch_project` gaten bereits
    // serverseitig auf "main" (`splash.rs`/`launch.rs`) — dieses Gate hier
    // erspart einem Sekundärfenster nur den nutzlosen IPC-Roundtrip.
    if (windowId.isMain) void invoke("main_ready");
  }, [windowId.isMain]);

  // Lädt den Onboarding-Stand einmal und hält ihn danach live — ein Reset
  // über den Settings-Button (anderes Fenster) sendet `onboarding:changed`,
  // das jedes Fenster hier ohne Poll mitbekommt (`onboarding/onboarding.ts`).
  useEffect(() => {
    let cancelled = false;
    void getOnboardingState().then((state) => {
      if (!cancelled) {
        setOnboardingCompletedState(state.completed);
        setWizardCompletedState(state.wizardCompleted);
      }
    });
    const unsubscribe = subscribeToOnboardingChanges((state) => {
      setOnboardingCompletedState(state.completed);
      setWizardCompletedState(state.wizardCompleted);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Existing-user migration for the wizard, same intent as the Aha-Moment
  // migration below it: a window that hydrates with a real project already
  // assigned (restored session, `panecrew <path>` CLI launch, or a pending
  // window project) is a returning user, not a first run — showing Welcome
  // to them would be exactly the "re-onboarded" regression the spec
  // forbids. Persists through the same async command + broadcast round trip
  // as every other onboarding-state change (`subscribeToOnboardingChanges`
  // above updates `wizardCompleted` once the broadcast lands) rather than
  // setting local state directly here — direct setState in an effect body
  // is exactly what `react-hooks/set-state-in-effect` exists to catch.
  //
  // Fires exactly ONCE, the first render where BOTH the session-restore
  // (`hydrated`) and the onboarding fetch (`wizardCompleted !== null`) have
  // landed — not on the `hydrated` transition alone, since the two fetches
  // are independent and race: gating on the transition would silently skip
  // this check whenever the onboarding fetch happens to resolve after
  // hydration completes. Never fires again after that first decision, so a
  // later Settings restart (which flips `wizardCompleted` back to `false`
  // on an already-long-hydrated window) always shows the wizard,
  // unconditionally, per the user's explicit "restart = see the guided
  // tour again."
  const wizardStartupDecisionMadeRef = useRef(false);
  useEffect(() => {
    if (wizardStartupDecisionMadeRef.current) return;
    if (!hydrated || wizardCompleted === null) return;
    wizardStartupDecisionMadeRef.current = true;
    if (!wizardCompleted && activePanes(gridState).length > 0) {
      void setOnboardingWizardCompleted(true);
      void info(
        "onboarding: [onboarding_skipped] phase=wizard reason=existing-session-at-startup",
      );
    }
  }, [hydrated, gridState, wizardCompleted]);

  // Der Aha-Moment: PaneCrews Kern-Alleinstellungsmerkmal ist das Raster aus
  // gleichzeitig sichtbaren Panes, nicht schon die erste offene Pane (die
  // sieht wie jedes andere Terminal aus). Vervollständigt genau bei diesem
  // ÜBERGANG (0/1 → ≥2 aktive Panes), nicht bei jedem Render, in dem bereits
  // ≥2 Panes offen sind — sonst würde ein Reset über die Settings bei einem
  // Nutzer, der schon zwei Panes offen hat, den Hinweis instantan wieder
  // abschließen, bevor er ihn überhaupt sieht (derselbe Zustand, den ein
  // Session-Restore mit bereits ≥2 Panes für einen Bestandsnutzer beim
  // allerersten Start korrekt sofort abschließt — nur beim ÜBERGANG selbst,
  // nicht als Dauerzustand).
  const previousAhaMomentReachedRef = useRef(false);
  useEffect(() => {
    const nowReached = onboardingShouldComplete(gridState);
    if (onboardingCompleted === false && !previousAhaMomentReachedRef.current && nowReached) {
      void setOnboardingCompleted(true);
      void info("onboarding: [onboarding_completed] [activation_event] trigger=aha-moment");
    }
    previousAhaMomentReachedRef.current = nowReached;
  }, [gridState, onboardingCompleted]);

  // Einmaliger Start-Ablauf (Ticket 06): erst die persistierte Sitzung
  // wiederherstellen (Template, Pane-Zuordnungen, letzte Dateiauswahl je
  // Pane), danach `panecrew <pfad>` darüberlegen — ein CLI-Startprojekt
  // gewinnt bewusst gegen Slot 0 der Sitzung, exakt das Verhalten von vor
  // diesem Ticket. Beide Schritte in EINEM Effekt statt zwei unabhängigen:
  // ein zweiter Effekt könnte parallel starten und Slot 0 der Sitzung mit
  // dem CLI-Pfad überschreiben, bevor die Sitzung überhaupt geladen ist.
  useEffect(() => {
    let cancelled = false;
    // TypeScript narrows a captured `let` to its last-checked literal value
    // across an `await` — it doesn't know the cleanup closure below can flip
    // it in between. Reading it back through a function call sidesteps that:
    // a call result is never narrowed the way a bare variable read is, so
    // every check downstream sees the real, current value instead of a
    // stale "always false" one baked in at the first `if`.
    const isCancelled = () => cancelled;

    const restoreSlot = async (
      slotIndex: number,
      projectPath: string,
      terminalTabs: readonly { title?: string | null }[],
      activeTab: { kind: "terminal"; index: number } | { kind: "file" },
      lastSelectedFile: string | null,
    ) => {
      const project = await loadProject(projectPath);
      if (isCancelled()) return;
      const { paneId, tabId: firstTabId } = assignProject(slotIndex, project.path);
      setRestoringSlots((current) => {
        if (!current.has(slotIndex)) return current;
        const next = new Set(current);
        next.delete(slotIndex);
        return next;
      });

      // `assignProject` legt bereits den ersten Terminal-Tab an — hier kommen
      // nur die WEITEREN dazu (Ticket 18). Eine leere/fehlende
      // `terminal_tabs`-Liste in einer fremden `session.json` unterschreitet
      // damit nie die Invariante "mindestens ein Terminal-Tab": die Schleife
      // läuft dann einfach keinmal, es bleibt beim einen Default-Tab.
      const tabIds = [firstTabId];
      for (let i = 1; i < terminalTabs.length; i += 1) {
        tabIds.push(openTerminalTab(paneId));
      }
      // Umbenennungen zurückspielen (Kontextmenü, `PaneTabs.tsx`) — je
      // Position, nicht je `tabId`: das persistierte Schema kennt keine
      // `tabId` (s. `PersistedActiveTab`-Kommentar in `sessionState.ts`),
      // dieselbe Positions-Zuordnung wie `activeTab.index` unten.
      tabIds.forEach((restoredTabId, i) => {
        const title = terminalTabs[i]?.title;
        if (title) renameTerminalTab(paneId, restoredTabId, title);
      });
      if (activeTab.kind === "terminal") {
        switchToTerminalTab(paneId, tabIds[activeTab.index] ?? firstTabId);
      }

      if (!lastSelectedFile) return;
      setSelectedFile((current) => ({ ...current, [paneId]: lastSelectedFile }));
      paneFileEditors.editorFor(paneId).open(`${project.path}/${lastSelectedFile}`);
      if (activeTab.kind === "file") switchToFileTab(paneId);
    };

    const run = async () => {
      const session = await loadSession();
      if (!isCancelled() && session) {
        const restoredTemplateId = restoredTemplate(session, windowId.label);
        switchTemplate(restoredTemplateId);
        // `switchTemplate` setzt `splitRatios` selbst immer auf leer zurück
        // (`gridState.ts`s Kommentar dort) — die gespeicherten Verhältnisse
        // kommen deshalb als EIGENER, nachgelagerter Schritt, gegen die
        // Track-Form GENAU dieses (frisch gewechselten) Templates validiert.
        setSplitRatios(
          normalizeRatios(
            restoredSplitRatios(session, windowId.label),
            trackShape(restoredTemplateId).columns,
            trackShape(restoredTemplateId).rows,
          ),
        );
        // Projektpfad-geschlüsselt wie im Live-Zustand — anders als
        // `restoreSlot` unten braucht das keine `paneId`-Zuordnung, der
        // gespeicherte Zustand passt unverändert auf `expandedFolders`. Beide
        // Felder sind window-agnostische Globals (Ticket 27) — jedes Fenster
        // liest denselben Stand, unabhängig von seinem eigenen `label`.
        setExpandedFolders(session.expanded_folders ?? {});
        setRecentProjects(session.recent_projects ?? []);
        if (session.explorer_width) {
          const restoredWidth = Math.min(
            EXPLORER_MAX_WIDTH,
            Math.max(EXPLORER_MIN_WIDTH, session.explorer_width),
          );
          setExplorerWidth(restoredWidth);
          setPersistedExplorerWidth(restoredWidth);
        }
        const slots = restoredSlots(session, windowId.label);
        // Vor dem ersten `await` in `restoreSlot` gesetzt, damit der erste
        // Render nach `switchTemplate` (leere Slots im neuen Template) sie
        // schon als "wird noch befüllt" statt als klickbare Picker zeigt.
        setRestoringSlots(
          new Set(slots.flatMap((slot, slotIndex) => (slot === null ? [] : [slotIndex]))),
        );
        // Parallel statt sequenziell: jeder Slot schreibt über
        // `assignProject`/`setSelectedFile`s Updater-Form einen eigenen,
        // unabhängigen Teil des States, Reihenfolge der Auflösung spielt also
        // keine Rolle. Sequenziell hätte sich die Ladezeit mehrerer Panes
        // beim Start aufaddiert statt sich zu überlappen — bei vier Panes
        // spürbar (Nutzerbeobachtung 2026-08-12).
        await Promise.all(
          slots.map((slot, slotIndex) =>
            slot === null || isCancelled()
              ? Promise.resolve()
              : restoreSlot(
                  slotIndex,
                  slot.project_path,
                  slot.terminal_tabs,
                  slot.active_tab,
                  slot.file_tab?.path ?? null,
                ),
          ),
        );
      }

      // `panecrew <pfad>` überspringt den Picker: Rust hat den Pfad schon
      // gegen das echte Dateisystem geprüft (existiert, ist ein
      // Verzeichnis), ein ungültiges/fehlendes Argument liefert hier einfach
      // `null` zurück. Landet immer in Slot 0, unabhängig davon, was die
      // Sitzung dort gerade wiederhergestellt hat. Ticket 27, landmine 4: nur
      // "main" bekommt den CLI-Pfad überhaupt (server-seitig gegated,
      // `windowId.isMain` erspart nur den IPC-Roundtrip für jedes andere
      // Fenster).
      const launchPath = windowId.isMain
        ? await invoke<string | null>("get_launch_project")
        : null;
      if (!isCancelled() && launchPath) {
        const project = await loadProject(launchPath);
        if (!isCancelled()) {
          assignProject(0, project.path);
          recordRecentProject(project.path);
        }
      }

      // Fensterseitiges Gegenstück zum CLI-Startpfad oben: ein Fenster, das
      // `window_open_new` mit einem Projekt erzeugt hat (die "Grid ist
      // voll — neues Fenster öffnen?"-Rückfrage weiter unten), holt sich
      // das genau einmal hier ab (`main` kann nie eine wartende Zuweisung
      // haben — es entsteht nie über `window_open_new`, daher dieselbe
      // `isMain`-Weiche wie oben, nur umgekehrt).
      const pendingProjectPath = !windowId.isMain
        ? await invoke<string | null>("take_pending_window_project")
        : null;
      if (!isCancelled() && pendingProjectPath) {
        const project = await loadProject(pendingProjectPath);
        if (!isCancelled()) {
          assignProject(0, project.path);
          recordRecentProject(project.path);
        }
      }

      if (!isCancelled()) setHydrated(true);
    };

    run().catch((error: unknown) => {
      console.error("PaneCrew: Sitzung konnte nicht wiederhergestellt werden", error);
      // Ein gescheiterter Restore darf keinen Slot dauerhaft im
      // Ladezustand einfrieren — ohne echten Fortschritt bliebe er sonst für
      // immer unklickbar.
      if (!isCancelled()) {
        setRestoringSlots(new Set());
        setHydrated(true);
      }
    });

    return () => {
      cancelled = true;
    };
    // Absichtlich nur beim Mount: `assignProject`/`switchTemplate`/
    // `loadProject` sind stabile Bindungen (s. o.), `paneFileEditors` bräuchte
    // für ein vollständiges Dep-Array eine eigene Memoisierung, die nur
    // dieser eine Einmal-Effekt fordern würde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistiert bei jeder relevanten Zustandsänderung automatisch (Ticket
  // 06) — Template-Wechsel, Pane-Zuweisung/-Schließen, Explorer-Navigation
  // lösen alle eine Änderung von `gridState` oder `selectedFile` aus, kein
  // eigener Speichern-Schritt nötig. Gesperrt bis `hydrated`, damit der
  // Leerzustand des allerersten Renders nicht die gerade geladene Sitzung
  // überschreibt, bevor sie überhaupt angewendet ist.
  // Ticket 27: pro Fenster statt als ganzes Sitzungs-Array — `expanded_
  // folders`/`explorer_width` bleiben dabei window-agnostische Globals
  // (`session_save_window`s eigener Kommentar), jedes Fenster schreibt seinen
  // eigenen Stand mit. Bei mehreren gleichzeitig offenen Fenstern gewinnt so
  // der zuletzt speichernde für diese zwei Felder — ein bewusst unaufgelöster
  // Rand dieser ansonsten window-genauen Persistenz (Ticket 27s Kriterien
  // decken nur Template/Panes/Fokus-Modus ab), keine Regression gegenüber
  // dem Vor-Ticket-27-Verhalten, das dieselbe Zuletzt-gewinnt-Semantik schon
  // hatte, nur eben nie mit einem zweiten Fenster.
  useEffect(() => {
    if (!hydrated) return;
    void saveSessionWindow(
      buildWindowState(windowId.label, gridState, selectedFile),
      expandedFolders,
      persistedExplorerWidth,
      recentProjects,
    );
  }, [
    hydrated,
    gridState,
    selectedFile,
    expandedFolders,
    persistedExplorerWidth,
    recentProjects,
    windowId.label,
  ]);

  // Die eine wartende Handlung hinter der Rückfrage „ungespeicherte Änderungen
  // verwerfen?" (Ticket 05). Bewusst ein schlichter lokaler Zustand und kein
  // Zweig in `fileEditorState.ts`: „wartet auf Bestätigung" ist keine Aussage
  // über die Datei — die liegt unverändert da, der Puffer ist unangetastet,
  // und ein Neustart der App würde diese Frage nicht wiederherstellen wollen.
  // Was die Zustandsmaschine dazu beiträgt, ist genau ein Boolean
  // (`wouldLoseWork`), und das hat sie schon.
  //
  // Gespeichert wird die Handlung als Thunk in einem Objekt, zusammen mit der
  // Pane, deren ungespeicherter Stand sie ausgelöst hat — der Dialog fragt
  // nach GENAU dieser Datei, unabhängig davon, was inzwischen anderswo im
  // Grid passiert. `useState` deutet eine direkt übergebene Funktion als
  // Updater, das Objekt drumherum ist der kürzere Weg als `setState(() =>
  // fn)`.
  const [pendingLeave, setPendingLeave] = useState<
    { paneId: string; run: () => void } | null
  >(null);

  // Die Rückfrage vor dem Schließen (Pane oder Terminal-Tab) — der Schutz
  // gegen das versehentlich getroffene Kreuz. Bewusst GETRENNT von
  // `pendingLeave`: das dort ist die Rückfrage nach ungespeicherter Arbeit,
  // die hier ist die Rückfrage nach einer laufenden Sitzung. Sie können nie
  // gleichzeitig offen sein (die eine Entscheidungsstelle in
  // `closePaneGuarded` unten wählt genau eine von beiden), aber sie zu einem
  // Zustand zusammenzuziehen hieße, ihre Bedingungen zu vermischen.
  //
  // Gespeichert wird neben der Handlung nur, was die Rückfrage BENENNEN muss.
  // Bewusst als Wert und nicht als Id: das Kreuz ist im Augenblick des Klicks
  // eindeutig, die Liste dahinter kann sich bis zur Antwort ändern — eine
  // nachträglich aufgelöste Id benennte dann etwas anderes als das, was der
  // Nutzer angeklickt hat.
  const [pendingClose, setPendingClose] = useState<
    | { target: "pane"; projectName: string; run: () => void }
    | { target: "terminalTab"; tabNumber: number; run: () => void }
    // Ein gemeinsamer Batch-Zweig für BEIDE Mehrfach-Schließen-Wege ("Andere
    // Tabs schließen", "Tabs rechts schließen") — beide brauchen exakt
    // dieselbe Rückfrage-Form (nur eine Zahl, keine Richtung), ein eigener
    // Zweig pro Weg hätte nur wortgleiche Übersetzungs-Keys verdoppelt.
    | { target: "terminalTabsBatch"; count: number; run: () => void }
    // Das ganze Fenster schließen (Ampel-Kreuz oder Cmd+Q) — die Rust-Seite
    // hat die Prüfung "gibt es überhaupt etwas zu verlieren" bereits selbst
    // gemacht (siehe der Listener unten) und fragt nur, wenn dieses Fenster
    // wirklich laufende Terminal-Sitzungen hat.
    | { target: "window"; run: () => void }
    | null
  >(null);

  // Die dritte, unabhängige Rückfrage-Fläche: "Ordner öffnen …"/"Zuletzt
  // geöffnet" bei komplett vollem Grid (`openProjectPathInEmptySlotOrNewWindow`
  // weiter unten) — der Projektpfad selbst trägt die ganze wartende
  // Handlung, ein neues Fenster braucht keinen weiteren Kontext als das.
  const [pendingGridFullOpen, setPendingGridFullOpen] = useState<
    string | null
  >(null);

  // Rust hat einen Schließversuch dieses Fensters (Ampel-Kreuz oder Cmd+Q)
  // bereits per `api.prevent_close()` angehalten, weil laufende PTYs daran
  // hängen — sonst wäre es hier nie eingetroffen. Bestätigt der Nutzer, ruft
  // `run()` denselben Schließversuch über den eigens dafür vorgesehenen
  // Befehl noch einmal auf, diesmal als bereits bestätigt.
  useEffect(() => {
    const unlistenPromise = listen("pc://window-close-requested", () => {
      setPendingClose({
        target: "window",
        run: () => {
          invoke("window_close_confirmed").catch((error: unknown) => {
            console.error("PaneCrew: Fenster konnte nicht geschlossen werden", error);
          });
        },
      });
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Der EINE Durchgang für jeden Weg, der eine offene Datei verlässt. Steht
  // absichtlich zwischen Absicht und Ausführung statt in den Aufrufern:
  // derselbe Dialog mehrfach direkt verdrahtet wären ebenso viele Stellen, an
  // denen er künftig auseinanderläuft. Pane-genau: nur der ungespeicherte
  // Stand DIESER Pane blockiert ihren eigenen Wechsel, nie den einer anderen.
  const guardLeave = (paneId: string, run: () => void) => {
    if (paneFileEditors.editorFor(paneId).wouldLoseWork) {
      setPendingLeave({ paneId, run });
      return;
    }
    run();
  };

  // Der Pfad der Datei, die die Editorfläche der fokussierten Pane gerade
  // führt — `null`, solange keine offen ist. Steht vor den Handlern darunter,
  // weil `selectFile` ihn braucht, um einen echten Wechsel von einem
  // erneuten Klick auf dieselbe Zeile zu unterscheiden.
  const openFilePath =
    fileEditor.state.status === "idle" ? null : fileEditor.state.path;

  // Öffnet den Ordner-Dialog für Slot `slotIndex` — leer oder belegt. Bei
  // einem belegten Slot ersetzt eine Zuweisung die Pane vollständig (neue
  // `paneId`, die alte PTY stirbt beim Remount, s. `PaneGrid.tsx`s
  // Invariante) — das ist einer der drei im Ticket benannten Verlassen-Wege
  // und wird deshalb genauso geguardet wie ein Dateiwechsel. `forget` räumt
  // den Editor-Zustand der verdrängten Pane auf; ohne das hielte der Record
  // in `usePaneFileEditors` sie für immer als "ungespeichert", falls sie das
  // beim Verdrängen war.
  const assignProjectToSlot = (slotIndex: number) => {
    const outgoing = gridState.slots[slotIndex];
    const proceed = () => {
      setPickingSlot(slotIndex);
      void defaultProjectPickerPath()
        .then((defaultPath) =>
          openFolderDialog({ directory: true, multiple: false, defaultPath }),
        )
        .then((selected) =>
          typeof selected === "string" ? loadProject(selected) : null,
        )
        .then((next) => {
          if (!next) return;
          if (outgoing) paneFileEditors.forget(outgoing.paneId);
          assignProject(slotIndex, next.path);
          recordRecentProject(next.path);
        })
        .catch((error: unknown) => {
          console.error("PaneCrew: Ordnerauswahl fehlgeschlagen", error);
        })
        .finally(() => setPickingSlot(null));
    };
    if (outgoing) guardLeave(outgoing.paneId, proceed);
    else proceed();
  };

  // Öffnet einen Eintrag der Recent-Projects-Liste (Ticket 22) direkt in
  // `slotIndex`, ohne den Dateiauswahldialog — derselbe Verdrängungs-Guard
  // wie `assignProjectToSlot` oben, weil ein belegter Zielslot genauso eine
  // laufende PTY beendet. `loadProject` scheitert für einen inzwischen
  // verschwundenen Ordner nicht (leerer Baum + `treeError`, s.
  // `loadProject.ts`), also kein gesonderter Fehlerpfad hier — derselbe
  // Zustand, den ein manuell über den Dialog erneut gewähltes, seitdem
  // gelöschtes Projekt auch hätte.
  const openRecentProject = (path: string, slotIndex: number) => {
    const outgoing = gridState.slots[slotIndex];
    const proceed = () => {
      setPickingSlot(slotIndex);
      void loadProject(path)
        .then((next) => {
          if (outgoing) paneFileEditors.forget(outgoing.paneId);
          assignProject(slotIndex, next.path);
          recordRecentProject(next.path);
        })
        .finally(() => setPickingSlot(null));
    };
    if (outgoing) guardLeave(outgoing.paneId, proceed);
    else proceed();
  };

  // Kontextmenü-Eintrag „Aus Liste entfernen" (Ticket 22) — löscht nur den
  // Listeneintrag, nie das Projekt selbst.
  const removeRecentProject = (path: string) =>
    setRecentProjects((current) => withoutRecentProject(current, path));

  // Phase 2, der kontextuelle Hinweis: rein aus dem laufenden Grid
  // abgeleitet, kein eigener "Phase"-Zustand
  // (`onboarding/onboardingState.ts`s Kopfkommentar) — dieselbe Herleitung
  // deckt den echten Erstlauf, einen über die Settings neu gestarteten
  // Hinweis mit noch freiem Slot, und den stillen No-op bei komplett vollem
  // Grid gleichermaßen ab. Zeigt sich erst NACH Phase 1 (`wizardCompleted
  // === true`) — solange der Wizard offen ist, überdeckt er ohnehin alles,
  // aber ohne dieses Gate würde `onboardingHintShownLoggedRef` unten schon
  // "gezeigt" loggen, bevor der Nutzer den Wizard überhaupt verlassen hat.
  const onboardingTourActive = onboardingCompleted === false && wizardCompleted === true;
  const onboardingHintSlotIndex = onboardingTourActive
    ? deriveOnboardingHintSlot(gridState)
    : null;
  // Kein freier Slot zum Verankern, aber die Tour ist aktiv UND der
  // Aha-Moment liegt bereits vor (`ahaReached`) — genau der Fall, den ein
  // Settings-Neustart auf einem bereits vollen Grid trifft (der ursprünglich
  // gemeldete Bug: "Einführung neu starten" zeigte dort gar nichts). Dieser
  // Fall bekommt die schwebende Variante statt des Slot-verankerten Hinweises.
  const onboardingFloatingActive =
    onboardingTourActive &&
    onboardingHintSlotIndex === null &&
    onboardingHintVariant(gridState) === "ahaReached";
  const dismissOnboardingHint = () => {
    void setOnboardingCompleted(true);
    void info("onboarding: [onboarding_skipped] phase=tour");
  };
  const onboardingHintCopyKey = {
    empty: { title: "onboarding.hint.empty.title", body: "onboarding.hint.empty.body" },
    hasPanes: {
      title: "onboarding.hint.hasPanes.title",
      body: "onboarding.hint.hasPanes.body",
    },
    ahaReached: {
      title: "onboarding.hint.ahaReached.title",
      body: "onboarding.hint.ahaReached.body",
    },
  }[onboardingHintVariant(gridState)];
  const onboardingHintNode =
    onboardingHintSlotIndex !== null ? (
      <OnboardingHint
        title={t(onboardingHintCopyKey.title)}
        body={t(onboardingHintCopyKey.body)}
        dismissLabel={t("onboarding.hint.dismiss")}
        onDismiss={dismissOnboardingHint}
      />
    ) : null;
  const onboardingFloatingHintNode = onboardingFloatingActive ? (
    <OnboardingFloatingHint
      title={t(onboardingHintCopyKey.title)}
      body={t(onboardingHintCopyKey.body)}
      dismissLabel={t("onboarding.hint.dismiss")}
      onDismiss={dismissOnboardingHint}
    />
  ) : null;
  const onboardingHintShownLoggedRef = useRef(false);
  useEffect(() => {
    const shown = onboardingHintSlotIndex !== null || onboardingFloatingActive;
    if (shown && !onboardingHintShownLoggedRef.current) {
      onboardingHintShownLoggedRef.current = true;
      void info(
        `onboarding: [onboarding_step_viewed] phase=tour variant=${onboardingHintVariant(gridState)}`,
      );
    }
    if (!shown) onboardingHintShownLoggedRef.current = false;
  }, [onboardingHintSlotIndex, onboardingFloatingActive, gridState]);

  // Phase 1, der Wizard: grid-unabhängig sichtbar (App-Fenster-Overlay, kein
  // Slot-Anker) — das macht "Einführung neu starten" zuverlässig, egal wie
  // voll das Grid gerade ist (anders als der reine Phase-2-Hinweis oben, der
  // ohne freien Slot nirgends verankern könnte). Zeigt sich erst nach
  // `hydrated`, um den Bestandsnutzer-Check oben eine Chance zu geben, ihn
  // lautlos zu unterdrücken, bevor er je sichtbar wird.
  const showOnboardingWizard = hydrated && wizardCompleted === false;
  const onboardingWizardStartedLoggedRef = useRef(false);
  useEffect(() => {
    if (showOnboardingWizard && !onboardingWizardStartedLoggedRef.current) {
      onboardingWizardStartedLoggedRef.current = true;
      void info("onboarding: [onboarding_started] phase=wizard step=0");
    }
    if (!showOnboardingWizard) onboardingWizardStartedLoggedRef.current = false;
  }, [showOnboardingWizard]);
  const onboardingWizardStepViewed = (step: 0 | 1) => {
    void info(`onboarding: [onboarding_step_viewed] phase=wizard step=${step}`);
  };
  const finishOnboardingWizard = () => {
    setWizardCompletedState(true);
    void setOnboardingWizardCompleted(true);
  };
  const onboardingWizardOpenFirstProject = () => {
    finishOnboardingWizard();
    void info(
      "onboarding: [onboarding_step_completed] [activation_event] phase=wizard step=1 action=open-first-project",
    );
    assignProjectToSlot(0);
  };
  const onboardingWizardSkip = () => {
    finishOnboardingWizard();
    void info("onboarding: [onboarding_skipped] phase=wizard");
  };

  // Zwei native Menüpunkte teilen sich dasselbe Ziel-Verhalten: "Ordner
  // öffnen …" (menu.rs' OPEN_FOLDER, Cmd/Ctrl+O) und ein Eintrag aus
  // "Zuletzt geöffnete Projekte" (RECENT_PROJECT_ITEM_PREFIX) landen immer im
  // ersten LEEREN Slot — ein explizites "Öffnen" darf NIEMALS eine
  // bestehende, unbeteiligte Pane überschreiben (User-Entscheidung
  // 2026-08-16, nach einem Bugreport: bis dahin fiel das bei vollem Grid
  // stillschweigend auf die fokussierte Pane zurück, was ein Öffnen aus der
  // "Zuletzt geöffnet"-Liste die fokussierte Pane überschreiben ließ, egal ob
  // das Grid überhaupt voll war). Ist das Grid komplett voll, fragt
  // `pendingGridFullOpen` (Rückfrage weiter unten) stattdessen nach, ob
  // PaneCrew das Projekt in einem NEUEN Fenster öffnen soll — nie in einem
  // bereits belegten Slot.
  const openProjectPathInEmptySlotOrNewWindow = (path: string) => {
    const emptyIndex = firstEmptySlotIndex(gridState);
    if (emptyIndex === -1) {
      setPendingGridFullOpen(path);
      return;
    }
    setPickingSlot(emptyIndex);
    void loadProject(path)
      .then((next) => {
        assignProject(emptyIndex, next.path);
        recordRecentProject(next.path);
      })
      .catch((error: unknown) => {
        console.error("PaneCrew: Projekt konnte nicht geöffnet werden", error);
      })
      .finally(() => setPickingSlot(null));
  };
  const openFolderMenuHandlerRef = useRef<(() => void) | null>(null);
  const openRecentProjectMenuHandlerRef = useRef<((path: string) => void) | null>(null);
  useEffect(() => {
    openFolderMenuHandlerRef.current = () => {
      void defaultProjectPickerPath()
        .then((defaultPath) =>
          openFolderDialog({ directory: true, multiple: false, defaultPath }),
        )
        .then((selected) => {
          if (typeof selected === "string") openProjectPathInEmptySlotOrNewWindow(selected);
        })
        .catch((error: unknown) => {
          console.error("PaneCrew: Ordnerauswahl fehlgeschlagen", error);
        });
    };
    openRecentProjectMenuHandlerRef.current = (path) => {
      openProjectPathInEmptySlotOrNewWindow(path);
    };
  });
  // Letzter der zehn Referenz-Editor-Menüaudit-Punkte: die native
  // "Tastaturkürzel …" (`menu.rs`s SHOW_SHORTCUTS) öffnet den Dialog, der
  // Dialog selbst kennt seinen Öffner nicht — reiner boolescher Zustand wie
  // die übrigen modalen Flächen dieser Datei.
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  // Erster der zehn Referenz-Editor-Menüaudit-Punkte: sowohl das native Menü
  // (⌘⇧P, `menu.rs`s SHOW_COMMAND_PALETTE) als auch der bisher rein visuelle
  // Sucher-Platzhalter in der Titelzeile (`TitleBar.tsx`) öffnen denselben
  // Zustand.
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  useEffect(() => {
    const unlistenPromises = [
      listen("menu:open-folder", () => openFolderMenuHandlerRef.current?.()),
      listen<string>("menu:open-recent-project", (event) =>
        openRecentProjectMenuHandlerRef.current?.(event.payload),
      ),
      listen("menu:show-shortcuts", () => setShortcutsDialogOpen(true)),
      listen("menu:show-command-palette", () => setCommandPaletteOpen(true)),
    ];
    return () => {
      for (const unlistenPromise of unlistenPromises) {
        void unlistenPromise.then((unlisten) => unlisten());
      }
    };
  }, []);

  // Befehlsliste: bewusst kein eigenes Registry-Modul — die Handlungen selbst
  // sind App.tsx-Closures (dieselben, die Menü/Knöpfe schon aufrufen), ein
  // Registry hätte hier keinen zweiten Konsumenten außer der Palette selbst.
  // Template-Wechsel nur, wenn gerade tatsächlich ausführbar
  // (`templateSwitchBlockReason`) — dieselbe Prüfung wie `TemplateSwitcher.tsx`,
  // ein gesperrter Eintrag in der Palette hätte ohne eigenes „warum" (die
  // Palette kennt kein deaktiviertes Zeilenbild) nur verwirrt.
  const commandPaletteCommands: PaletteCommand[] = [
    ...GRID_TEMPLATES.filter(
      (template) => templateSwitchBlockReason(gridState, template.id) === null,
    ).map((template) => ({
      id: `template.${template.id}`,
      label: t("commandPalette.switchTemplate", { template: t(template.labelKey) }),
      run: () => switchTemplate(template.id),
    })),
    ...(focusedPaneId !== null && nextGrowthTemplate(gridState.template) !== null
      ? [
          {
            id: "app.splitPane",
            label: t("commandPalette.splitPane"),
            run: splitFocusedPane,
          },
        ]
      : []),
    {
      id: "app.openFolder",
      label: t("commandPalette.openFolder"),
      run: () => openFolderMenuHandlerRef.current?.(),
    },
    {
      id: "app.openSettings",
      label: t("titleBar.settings"),
      run: () => void invoke("settings_open_window"),
    },
    {
      id: "app.showShortcuts",
      label: t("shortcutsReference.title"),
      run: () => setShortcutsDialogOpen(true),
    },
  ];

  // Schließt eine einzelne Pane — geguardet auf ihren eigenen ungespeicherten
  // Stand, unabhängig davon, was in den anderen Panes liegt.
  //
  // Hier steht die EINE Entscheidungsstelle zwischen den beiden Rückfragen,
  // und sie ist eine Verzweigung, keine Verkettung: wer ungespeicherte Arbeit
  // in dieser Pane liegen hat, bekommt AUSSCHLIESSLICH die
  // Ungespeichert-Rückfrage. Die ist die stärkere Aussage — sie benennt einen
  // Verlust, den kein Neustart zurückholt, während die Schließen-Rückfrage nur
  // eine Sitzung meint. Zwei Rückfragen nacheinander für einen Klick wären
  // nicht doppelt so sicher, sondern nur doppelt so lästig; die zweite würde
  // reflexhaft weggeklickt und entwertete damit auch die erste.
  const closePaneGuarded = (paneId: string) => {
    const run = () => {
      closePane(paneId);
      paneFileEditors.forget(paneId);
    };
    if (paneFileEditors.editorFor(paneId).wouldLoseWork) {
      guardLeave(paneId, run);
      return;
    }
    const pane = gridState.slots.find((slot) => slot?.paneId === paneId);
    // Ohne Pane keine Rückfrage: der Zustand ist nicht erreichbar (das Kreuz
    // hängt an genau dieser Pane), aber eine Rückfrage, die ihr Objekt nicht
    // benennen kann, wäre schlechter als gar keine.
    if (!pane) {
      run();
      return;
    }
    setPendingClose({
      target: "pane",
      projectName: projectNameFromPath(pane.projectPath),
      run,
    });
  };

  // Dasselbe Kreuz eine Ebene tiefer: ein Terminal-Tab. Hier gibt es keinen
  // Dateizustand zu prüfen — der hängt an der Pane, nicht am Tab — also auch
  // keine Verzweigung, nur die eine Rückfrage. Der letzte verbliebene Tab
  // einer Pane trägt gar kein Kreuz (`PaneTabs.tsx`), dieser Weg kann eine
  // Pane also nie leer zurücklassen.
  const closeTerminalTabGuarded = (paneId: string, tabId: string) => {
    const run = () => closeTerminalTab(paneId, tabId);
    const pane = gridState.slots.find((slot) => slot?.paneId === paneId);
    const index = pane?.terminalTabs.findIndex((tab) => tab.tabId === tabId);
    if (index === undefined || index < 0) {
      run();
      return;
    }
    // Dieselbe Zählung wie die Beschriftung des Chips selbst (`PaneTabs.tsx`
    // nummeriert nach Position, nicht nach Id) — die Rückfrage nennt damit
    // genau die Zahl, die auf dem angeklickten Tab steht.
    setPendingClose({ target: "terminalTab", tabNumber: index + 1, run });
  };

  // Pro-Tab-Ressourcen-Eskalationskette (`resource_guard.rs`): "Neu starten"
  // im Terminated-Banner (`TabResourceBanner.tsx`). Öffnet ZUERST den
  // frischen Tab — das macht den toten sicher nicht mehr zum letzten Tab der
  // Pane (`closeTerminalTab` lehnt das Schließen des letzten Tabs sonst
  // stillschweigend ab, s. gridState.ts) — und schließt DANACH den toten
  // ungefragt: kein `pendingClose`-Dialog wie bei `closeTerminalTabGuarded`,
  // denn die Sitzung ist bereits vom Backend beendet (Tier 4), es gibt
  // nichts mehr zu bestätigen, und der übliche Dialogtext ("die laufende
  // Sitzung endet") wäre für einen bereits toten Tab schlicht falsch. Räumt
  // zuletzt den Ressourcen-Registereintrag der toten `tabId` weg.
  const restartTerminatedTab = (paneId: string, deadTabId: string) => {
    openTerminalTab(paneId);
    closeTerminalTab(paneId, deadTabId);
    disposeResourceGuardEntry(deadTabId);
  };

  // Gemeinsamer Kern für BEIDE Mehrfach-Schließen-Wege unten — die Ids werden
  // VOR dem eigentlichen Schließen eingefroren, weil jedes Schließen die
  // Liste der Pane verändert und ein Nachschlagen währenddessen die falschen
  // Tabs träfe. `closeTerminalTab` ist pro Aufruf ein funktionales
  // `setState`-Update (`useGrid.ts`), die Schleife reiht sie also korrekt
  // aneinander, jede auf dem Ergebnis der vorigen.
  const guardBatchClose = (paneId: string, targetTabIds: readonly string[]) => {
    if (targetTabIds.length === 0) return;
    const run = () => {
      for (const targetTabId of targetTabIds) closeTerminalTab(paneId, targetTabId);
    };
    setPendingClose({ target: "terminalTabsBatch", count: targetTabIds.length, run });
  };

  // Browser-übliches "Andere Tabs schließen" (`PaneTabs.tsx`s Kontextmenü).
  const closeOtherTerminalTabsGuarded = (paneId: string, tabId: string) => {
    const pane = gridState.slots.find((slot) => slot?.paneId === paneId);
    if (!pane) return;
    guardBatchClose(
      paneId,
      pane.terminalTabs.filter((tab) => tab.tabId !== tabId).map((tab) => tab.tabId),
    );
  };

  // Browser-übliches "Tabs rechts schließen" (`PaneTabs.tsx`s Kontextmenü).
  const closeTerminalTabsToRightGuarded = (paneId: string, tabId: string) => {
    const pane = gridState.slots.find((slot) => slot?.paneId === paneId);
    const index = pane?.terminalTabs.findIndex((tab) => tab.tabId === tabId);
    if (!pane || index === undefined || index < 0) return;
    guardBatchClose(
      paneId,
      pane.terminalTabs.slice(index + 1).map((tab) => tab.tabId),
    );
  };

  // Zieht der LETZTE Terminal-Tab einer Pane in eine andere (seit der
  // Präzisions-Runde erlaubt, Nutzer-Entscheidung), leert sich der
  // Quell-Slot (`gridState.ts`) — für den Editor-Zustand der Quelle ist das
  // dasselbe Verlassen wie `closePaneGuarded`: ungespeicherter Stand fragt
  // per `guardLeave` nach, danach räumt `forget` auf (sonst hielte
  // `usePaneFileEditors` die verschwundene Pane für immer als
  // "ungespeichert"). BEWUSST ohne die Sitzungs-Rückfrage (`pendingClose`)
  // des Schließen-Wegs: hier stirbt keine PTY — der Tab lebt mitsamt seiner
  // Sitzung in der Ziel-Pane weiter, das ist der ganze Sinn des Zugs. Jeder
  // andere Zug (Quelle behält Tabs, oder Umsortieren innerhalb einer Pane)
  // läuft ungefragt durch.
  const moveTerminalTabGuarded = (
    sourcePaneId: string,
    tabId: string,
    targetPaneId: string,
    insertIndex: number | null,
  ) => {
    const source = gridState.slots.find((slot) => slot?.paneId === sourcePaneId);
    const emptiesSource =
      sourcePaneId !== targetPaneId && source?.terminalTabs.length === 1;
    const run = () => {
      moveTerminalTab(sourcePaneId, tabId, targetPaneId, insertIndex ?? undefined);
      if (emptiesSource) paneFileEditors.forget(sourcePaneId);
    };
    if (emptiesSource) guardLeave(sourcePaneId, run);
    else run();
  };

  // Der Zug auf einen LEEREN Slot (dort entsteht eine frische Pane im Projekt
  // der Quelle, der Tab wandert hinein) — dieselbe Guard-Logik wie
  // `moveTerminalTabGuarded` direkt darüber: leert der Zug die Quelle (ihr
  // letzter Tab), fragt ungespeicherter Editor-Stand nach und `forget` räumt
  // danach auf; auch hier bewusst ohne Sitzungs-Rückfrage, die PTY lebt in
  // der neuen Pane weiter.
  const moveTerminalTabToEmptySlotGuarded = (
    sourcePaneId: string,
    tabId: string,
    slotIndex: number,
  ) => {
    const source = gridState.slots.find((slot) => slot?.paneId === sourcePaneId);
    const emptiesSource = source?.terminalTabs.length === 1;
    const run = () => {
      moveTerminalTabToEmptySlot(sourcePaneId, tabId, slotIndex);
      if (emptiesSource) paneFileEditors.forget(sourcePaneId);
    };
    if (emptiesSource) guardLeave(sourcePaneId, run);
    else run();
  };

  // Ein Klick auf eine Datei im Baum tut ab jetzt zweierlei: er markiert die
  // Zeile UND öffnet die Datei in der Editorfläche. Bewusst kein zusätzlicher
  // Doppelklick-Handler (Nutzerentscheidung, deckt sich mit Story 8 des
  // Tickets) — der bestehende Einfachklick-Pfad bekommt die zweite Wirkung.
  //
  // Der Baum führt seine Pfade projekt-relativ (`TreeRow` baut sie als
  // `${eltern}/${name}`, Tiefe 0 der bloße Name), `explorer_read_file` will
  // einen absoluten — zusammengesetzt wird genau hier, im selben Muster, das
  // die Anlege-Zeile des Explorers schon für `explorer_create_file` verwendet.
  //
  // `line` (Ticket 26, Inhaltssuche): kommt von einer angeklickten
  // Treffer-Zeile statt vom Dateinamen selbst — `fileEditor.open` reicht sie
  // nur durch, den tatsächlichen Sprung im Puffer macht `FileEditor.tsx`
  // erst, sobald der Ladevorgang fertig ist.
  const selectFile = (path: string, line?: number) => {
    // Der Explorer wird nur sichtbar, solange eine Pane fokussiert ist und
    // deren Projekt geladen ist (s. u.) — `focusedPaneId`/`project` sind hier
    // also praktisch immer gesetzt. Die Prüfung steht für TypeScript, nicht
    // für einen echten Fall.
    if (focusedPaneId === null || project === null) return;
    const absolutePath = `${project.path}/${path}`;

    // Ein Klick auf die bereits offene Datei ist kein Wechsel — die Fläche
    // zeigt sie schon. Solange ungespeicherter Stand darin liegt, wäre ein
    // erneutes `open()` sogar genau der stille Verlust, den dieses Ticket
    // ausschließt: es läse die Datei frisch von der Platte und überschriebe
    // den Puffer wortlos. Der Klick bleibt dann folgenlos, statt zu fragen —
    // gefragt wird beim Verlassen, und hier verlässt niemand etwas.
    //
    // Ohne ungespeicherten Stand lädt derselbe Klick weiterhin neu; das ist
    // der einzige Weg, einen gescheiterten Lesevorgang zu wiederholen.
    if (absolutePath === openFilePath && fileEditor.wouldLoseWork) return;

    // Auswahl-Markierung und Öffnen gehören in DIESELBE Handlung: bliebe das
    // `setSelectedFile` außerhalb, hübe ein Abbruch die Zeile im Baum hervor,
    // während die Fläche daneben unverändert die alte Datei zeigt.
    guardLeave(focusedPaneId, () => {
      setSelectedFile((current) => ({ ...current, [focusedPaneId]: path }));
      fileEditor.open(absolutePath, line);
      switchToFileTab(focusedPaneId);
    });
  };

  // Der ungespeicherte Stand bekommt seine Marke an ZWEI Stellen: in der
  // Kopfzeile der Editorfläche und in der Baumzeile der Datei. Die zweite
  // braucht den Pfad in der Konvention des Baums (projekt-relativ, wie
  // `selectedFile`) — der Editor führt ihn absolut, weil das Backend ihn so
  // will. Zurückgerechnet wird deshalb genau hier, spiegelbildlich zur
  // Zusammensetzung in `selectFile`.
  const dirtyFile =
    fileEditor.wouldLoseWork &&
    openFilePath !== null &&
    project !== null &&
    openFilePath.startsWith(`${project.path}/`)
      ? openFilePath.slice(project.path.length + 1)
      : null;

  // Trägt eine Explorer-Umbenennung (Ticket 24) über jeden Ort, der einen
  // Pfad projekt-relativ hält, hinweg mit — spiegelbildlich zu
  // `paneFileEditors.renamePath`, das dasselbe für die absoluten Pfade der
  // offenen Puffer erledigt. `oldRelPath`/`newRelPath` kommen unverändert aus
  // `ExplorerPanel`, in dessen eigener Konvention (projekt-relativ).
  //
  // `selectedFile` ist EIN Record über ALLE Panes, nicht nur die des gerade
  // umbenennenden Projekts — zwei Panes können unterschiedliche Projekte
  // offen haben und dabei zufällig denselben projekt-relativen Pfad markiert
  // haben (z. B. beide "src/index.ts"). Ein Remap ohne Projekt-Filter träfe
  // dann auch die Pane des FREMDEN Projekts. Eingegrenzt wird deshalb auf die
  // Panes, deren `projectPath` genau dieses Projekt ist — dieselbe Prüfung,
  // die `paneFileEditors.renamePath`/`closeUnder` sich sparen können, weil sie
  // mit bereits absoluten (und damit projekt-eindeutigen) Pfaden arbeiten.
  const onEntryRenamed = (oldRelPath: string, newRelPath: string) => {
    if (project === null) return;
    paneFileEditors.renamePath(
      `${project.path}/${oldRelPath}`,
      `${project.path}/${newRelPath}`,
    );
    const paneIdsInProject = new Set(
      activePanes(gridState)
        .filter((pane) => pane.projectPath === project.path)
        .map((pane) => pane.paneId),
    );
    setSelectedFile((current) =>
      Object.fromEntries(
        Object.entries(current).map(([paneId, path]) => [
          paneId,
          paneIdsInProject.has(paneId)
            ? remapRenamedPath(path, oldRelPath, newRelPath)
            : path,
        ]),
      ),
    );
  };

  // Schließt jeden offenen Puffer unter einer gelöschten Explorer-Datei/einem
  // gelöschten Ordner (über `paneFileEditors.closeUnder`) UND nimmt die
  // Auswahl-Markierung jeder Pane DIESES Projekts mit, die genau dorthin
  // zeigte — sonst bliebe eine Baumzeile markiert, die es nicht mehr gibt.
  // Derselbe Projekt-Filter wie bei `onEntryRenamed`, aus demselben Grund.
  const onEntryDeleted = (relPath: string) => {
    if (project === null) return;
    paneFileEditors.closeUnder(`${project.path}/${relPath}`);
    const paneIdsInProject = new Set(
      activePanes(gridState)
        .filter((pane) => pane.projectPath === project.path)
        .map((pane) => pane.paneId),
    );
    setSelectedFile((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([paneId, path]) =>
            !(paneIdsInProject.has(paneId) && isPathOrDescendant(path, relPath)),
        ),
      ),
    );
  };

  const nudgeExplorerWidth = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8;
    const delta =
      e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = Math.min(
      EXPLORER_MAX_WIDTH,
      Math.max(EXPLORER_MIN_WIDTH, explorerWidth + delta),
    );
    setExplorerWidth(next);
    setPersistedExplorerWidth(next);
  };

  const startExplorerResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startWidth = explorerWidth;
    let latestWidth = startWidth;
    setResizingExplorer(true);
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      latestWidth = Math.min(
        EXPLORER_MAX_WIDTH,
        Math.max(EXPLORER_MIN_WIDTH, startWidth + ev.clientX - startX),
      );
      // Direkte DOM-Mutation statt `setExplorerWidth` — s. Kommentar an
      // `explorerContainerRef` oben. Kein React-Commit pro Zeigerbewegung.
      explorerContainerRef.current?.style.setProperty(
        "--pc-explorer-live-width",
        `${latestWidth}px`,
      );
    };
    const onUp = () => {
      setResizingExplorer(false);
      // Einziger Commit des ganzen Drags: `explorerWidth` holt die
      // Live-Override erst hier ein, der `useLayoutEffect` oben räumt sie
      // danach ohne sichtbaren Sprung wieder ab.
      setExplorerWidth(latestWidth);
      setPersistedExplorerWidth(latestWidth);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="relative flex h-full flex-col">
        <TitleBar
          zoom={zoom}
          panes={activePanes(gridState)}
          onNavigatePane={navigatePane}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />
        {/* Die Titelzeile schwebt (absolut positioniert) über dieser Fläche,
            statt sie als Flow-Element nach unten zu drücken. Der Freiraum wird
            hier reserviert, damit nichts dauerhaft verdeckt ist — geteilt durch
            den Zoomfaktor, weil die Kapsel darüber physisch konstant bleibt. */}
        {/* `relative`: Anker für das FocusTrace-Overlay unten, das Explorer-
            Naht UND Grid überspannen muss — im Explorer oder in <main> allein
            gerendert würde die Leiterbahn an deren Kante beschnitten (dasselbe
            Argument wie beim PathDragGhost ganz außen). */}
        <div
          ref={explorerContainerRef}
          style={{ paddingTop: `${TITLE_BAR_ZONE_HEIGHT / zoom}px` }}
          className="relative flex min-h-0 flex-1"
        >
          {/* Ohne offenes Projekt gibt es nichts, dem der Explorer folgen
              könnte — er erscheint erst mit der Pane. "Dauerhaft sichtbar"
              aus dem Direction Contract beschreibt den Arbeitszustand. */}
          {project === null ? null : explorerCollapsed ? (
            <CollapsedExplorerStrip
              onExpand={() => setExplorerCollapsed(false)}
            />
          ) : (
            <>
              {/* Explorer folgt der fokussierten Pane; key erzwingt frischen
                  Baum-State (Auswahl/Einklapp-Zustand) pro Projektwechsel. */}
              <ExplorerPanel
                key={project.path}
                project={project}
                width={explorerWidth}
                resizing={resizingExplorer}
                selectedFile={selectedFile[focusedPaneId ?? ""] ?? ""}
                dirtyFile={dirtyFile}
                initialExpanded={expandedFolders[project.path]}
                onExpandedChange={(paths) =>
                  setExpandedFolders((current) => ({
                    ...current,
                    [project.path]: [...paths],
                  }))
                }
                onSelectFile={selectFile}
                onCollapse={() => setExplorerCollapsed(true)}
                onRefresh={refreshExplorer}
                onLoadChildren={(relPath) => loadExplorerChildren(project.path, relPath)}
                onStartPathDrag={explorerDrag.startDrag}
                draggingPath={explorerDrag.draggingPath}
                onConsumeDragClick={explorerDrag.consumeDragClick}
                onEntryRenamed={onEntryRenamed}
                onEntryDeleted={onEntryDeleted}
                openSearchSignal={openSearchSignal}
              />
              {/* tabIndex + Pfeiltasten, weil ein reiner Ziehgriff die
                  Explorer-Breite für Tastaturnutzer unerreichbar macht — das
                  ist die ARIA-Rolle "separator" in ihrer bedienbaren Form
                  (aria-valuenow/min/max gehören dann dazu). */}
              <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label={t("titleBar.explorerWidthAria")}
                aria-valuenow={explorerWidth}
                aria-valuemin={EXPLORER_MIN_WIDTH}
                aria-valuemax={EXPLORER_MAX_WIDTH}
                onPointerDown={startExplorerResize}
                onDoubleClick={() => setExplorerCollapsed(true)}
                onKeyDown={nudgeExplorerWidth}
                className={`relative z-10 -ml-[3px] w-[5px] shrink-0 cursor-col-resize transition-colors duration-150 focus-visible:bg-(--pc-focusBorder) focus-visible:outline-none ${
                  resizingExplorer
                    ? "bg-(--pc-focusBorder)"
                    : "bg-transparent hover:bg-(--pc-focusBorder)/45"
                }`}
              />
              {/* Pin-Header "J1" der Fokus-Leiterbahn — dockt an der Naht an,
                  auf der der Separator sitzt, ohne ihn umzubauen (eigenes
                  Nullbreiten-Element, s. FocusPinHeader.tsx). Ein Pin je
                  belegtem Slot, Klick = Fokuswechsel. */}
              <FocusPinHeader
                pins={gridState.slots.flatMap((slot, index) =>
                  slot
                    ? [
                        {
                          paneId: slot.paneId,
                          slotNumber: index + 1,
                          projectName: projectNameFromPath(slot.projectPath),
                        },
                      ]
                    : [],
                )}
                focusedPaneId={focusedPaneId}
                onFocusPane={focusPane}
              />
            </>
          )}
          <main className="flex min-w-0 flex-1 flex-col p-2">
            {/* Eine Zeile, zwei Enden: links das Instrument, rechts die
                Bedienung. `justify-end` plus `mr-auto` am Readout statt
                `justify-between`: im leeren Raster rendert die Statuszeile gar
                nichts, und `justify-between` schöbe den Switcher dann an die
                LINKE Kante — also ausgerechnet auf dem ersten Bildschirm, den
                jemand sieht, und mit einem Sprung nach rechts, sobald das
                erste Projekt geöffnet ist. So bleibt er an der rechten Kante,
                wo er vor dem Readout schon stand, unabhängig davon, ob links
                etwas steht. */}
            <div className="mb-2 flex shrink-0 items-center justify-end gap-2">
              <GridStatusRail state={gridState} />
              <TemplateSwitcher
                state={gridState}
                onSwitchTemplate={switchTemplate}
              />
            </div>
            {/* Jede Pane trägt ihr eigenes Terminal+Editor-Paar (Begründung
                fürs Nur-Ausblenden statt Unmount jetzt in `PaneGrid.tsx`).
                Ein leerer Slot zeigt seinen eigenen Ordner-Dialog-Platzhalter
                — nie mehr die volle `<main>`-Leerdarstellung, die es vor
                Ticket 03 hier gab. */}
            <PaneGrid
              state={gridState}
              paneFileEditors={paneFileEditors}
              guardLeave={guardLeave}
              pickingSlot={pickingSlot}
              restoringSlots={restoringSlots}
              dropTargets={dropTargets}
              // Die beiden Drop-Quellen werden HIER zu einem Wert
              // zusammengeführt, nicht in der Pane: für sie ist „etwas
              // schwebt über mir" ein Zustand, kein Paar. Sie schließen
              // einander ohnehin aus — ein Zeiger kann nicht gleichzeitig
              // eine Baumzeile ziehen und eine Datei aus dem Finder halten.
              dragTargetPaneId={dragTargetPaneId ?? explorerDrag.targetPaneId}
              onAssignProject={assignProjectToSlot}
              recentProjects={recentProjects}
              onOpenRecentProject={openRecentProject}
              onRemoveRecentProject={removeRecentProject}
              onClosePane={closePaneGuarded}
              onRestartTerminatedTab={restartTerminatedTab}
              onSwapPanes={swapPanes}
              // Ungeguardet wie der Tausch: die Pane bleibt vollständig
              // bestehen (kein PTY-Ende, kein Editor-Verlust), nur ihre
              // Slot-Position ändert sich.
              onMovePaneToEmptySlot={movePaneToEmptySlot}
              onFocusPane={focusPane}
              onOpenTerminalTab={openTerminalTab}
              onCloseTerminalTab={closeTerminalTabGuarded}
              onCloseOtherTerminalTabs={closeOtherTerminalTabsGuarded}
              onCloseTerminalTabsToRight={closeTerminalTabsToRightGuarded}
              onRenameTerminalTab={renameTerminalTab}
              onMoveTerminalTab={moveTerminalTabGuarded}
              onMoveTerminalTabToEmptySlot={moveTerminalTabToEmptySlotGuarded}
              onSwitchToTerminalTab={switchToTerminalTab}
              onSwitchToFileTab={switchToFileTab}
              onEnterFocusMode={enterFocusMode}
              onExitFocusMode={exitFocusMode}
              onChangeSplitRatios={setSplitRatios}
              rotation={focusRotation}
              onboardingHintSlot={onboardingHintSlotIndex}
              onboardingHint={onboardingHintNode}
            />
          </main>
          {/* Die bestromte Leiterbahn vom aktiven Pin zur fokussierten Pane —
              nur solange es den Pin-Header gibt (dieselbe Bedingung wie der
              Explorer-Zweig oben): ohne Naht kein Startpunkt. Als LETZTES Kind
              des relativen Containers, damit das Overlay über Explorer,
              Separator und Grid liegt. */}
          {project !== null && !explorerCollapsed && (
            <FocusTrace
              focusedPaneId={focusedPaneId}
              template={gridState.template}
              slots={gridState.slots}
              maximizedPaneId={gridState.maximizedPaneId}
            />
          )}
        </div>
        {/* Außerhalb des `project !== null`-Zweigs: die bestätigte Handlung
            kann genau dieses Projekt schließen (`closeProject`), und ein
            Dialog, der sich im selben Augenblick mit seiner Umgebung
            aushängt, gibt den Fokus nicht mehr geordnet zurück.

            Der Dateiname kommt bewusst aus der Pane, die `pendingLeave`
            genannt hat — nicht aus der zufällig fokussierten. Mit mehreren
            Panes (ab Schritt 5) kann das auseinanderfallen; heute sind sie
            noch identisch. `pendingLeave` wird nur bei `wouldLoseWork`
            gesetzt, und das bedingt einen Nicht-idle-Zustand — der Pfad ist
            hier also immer da; die Prüfung steht für TypeScript, nicht für
            den Fall. */}
        {pendingLeave !== null &&
          (() => {
            const state = paneFileEditors.editorFor(pendingLeave.paneId).state;
            const path = state.status === "idle" ? null : state.path;
            return (
              path !== null && (
                <UnsavedChangesDialog
                  fileName={fileNameFromPath(path)}
                  onConfirm={pendingLeave.run}
                  onClose={() => setPendingLeave(null)}
                />
              )
            );
          })()}
        {/* Die zweite Rückfrage, gleiche Fläche, andere Worte. Beide Zweige
            stehen nebeneinander statt ineinander: sie schließen sich per
            Konstruktion aus (`closePaneGuarded`), und ein verschachtelter
            Ausdruck würde diese Ausschließlichkeit behaupten, wo sie ohnehin
            schon gilt. */}
        {pendingClose !== null && (
          <ConfirmDialog
            title={t(
              pendingClose.target === "pane"
                ? "closeDialog.paneTitle"
                : pendingClose.target === "terminalTab"
                  ? "closeDialog.terminalTabTitle"
                  : pendingClose.target === "terminalTabsBatch"
                    ? "closeDialog.terminalTabsBatchTitle"
                    : "closeDialog.windowTitle",
              pendingClose.target === "terminalTabsBatch"
                ? { count: pendingClose.count }
                : undefined,
            )}
            description={
              // Dasselbe Rezept wie bei der Ungespeichert-Rückfrage: das
              // Objekt, um das es geht, steht im vollen Vordergrund, und wo
              // im Satz es steht, entscheidet die Übersetzung.
              pendingClose.target === "pane" ? (
                <Trans
                  i18nKey="closeDialog.paneDescription"
                  values={{ projectName: pendingClose.projectName }}
                  components={{
                    bold: (
                      <span className="font-medium text-(--pc-foreground)" />
                    ),
                  }}
                />
              ) : pendingClose.target === "terminalTab" ? (
                <Trans
                  i18nKey="closeDialog.terminalTabDescription"
                  values={{ number: pendingClose.tabNumber }}
                  components={{
                    bold: (
                      <span className="font-medium text-(--pc-foreground)" />
                    ),
                  }}
                />
              ) : pendingClose.target === "terminalTabsBatch" ? (
                <Trans
                  i18nKey="closeDialog.terminalTabsBatchDescription"
                  count={pendingClose.count}
                  values={{ count: pendingClose.count }}
                  components={{
                    bold: (
                      <span className="font-medium text-(--pc-foreground)" />
                    ),
                  }}
                />
              ) : (
                t("closeDialog.windowDescription")
              )
            }
            confirmLabel={t(
              pendingClose.target === "pane"
                ? "closeDialog.confirmPane"
                : pendingClose.target === "terminalTab"
                  ? "closeDialog.confirmTerminalTab"
                  : pendingClose.target === "terminalTabsBatch"
                    ? "closeDialog.confirmTerminalTabsBatch"
                    : "closeDialog.confirmWindow",
              pendingClose.target === "terminalTabsBatch"
                ? { count: pendingClose.count }
                : undefined,
            )}
            cancelLabel={t("closeDialog.cancel")}
            onConfirm={pendingClose.run}
            onClose={() => setPendingClose(null)}
          />
        )}
        {/* Die dritte Rückfrage-Fläche, dieselbe Form, wieder andere Worte:
            "Ordner öffnen …"/"Zuletzt geöffnet" bei komplett vollem Grid.
            Anders als die beiden oben ist diese hier nicht destruktiv im
            eigentlichen Sinn (nichts geht verloren, egal wie geantwortet
            wird) — aber `ConfirmDialog` ist die einzige Rückfrage-Fläche
            dieser App, und ein zweites, undestruktives Hinweis-Widget nur
            für diesen einen Fall wäre mehr eigene Form, als der Anlass
            rechtfertigt. */}
        {pendingGridFullOpen !== null && (
          <ConfirmDialog
            title={t("gridFullDialog.title")}
            description={
              <Trans
                i18nKey="gridFullDialog.description"
                values={{ projectName: projectNameFromPath(pendingGridFullOpen) }}
                components={{
                  bold: (
                    <span className="font-medium text-(--pc-foreground)" />
                  ),
                }}
              />
            }
            confirmLabel={t("gridFullDialog.confirm")}
            cancelLabel={t("closeDialog.cancel")}
            onConfirm={() => {
              void invoke("window_open_new", {
                initialProject: pendingGridFullOpen,
              });
            }}
            onClose={() => setPendingGridFullOpen(null)}
          />
        )}
        {/* Ganz außen, damit die Plakette über Explorer UND Panes liegt — im
            Explorer gerendert würde sie an dessen Kante beschnitten, und
            genau über diese Kante führt der Weg. */}
        {explorerDrag.draggingPath !== null &&
          explorerDrag.ghostOrigin !== null && (
            <PathDragGhost
              ghostRef={explorerDrag.ghostRef}
              path={explorerDrag.draggingPath}
              origin={explorerDrag.ghostOrigin}
              overPane={explorerDrag.targetPaneId !== null}
            />
          )}
        <UpdateBanner />
        <ShortcutsReferenceDialog
          open={shortcutsDialogOpen}
          onOpenChange={setShortcutsDialogOpen}
        />
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          commands={commandPaletteCommands}
        />
        {onboardingFloatingHintNode}
        {showOnboardingWizard && (
          <OnboardingWizard
            copy={{
              welcomeTitle: t("onboarding.wizard.welcome.title"),
              welcomeBody: t("onboarding.wizard.welcome.body"),
              welcomeCta: t("onboarding.wizard.welcome.cta"),
              readyTitle: t("onboarding.wizard.ready.title"),
              readyBody: t("onboarding.wizard.ready.body"),
              readyCtaOpenProject: t("onboarding.wizard.ready.cta"),
              readySkip: t("onboarding.wizard.ready.skip"),
              readyBodyExisting: t("onboarding.wizard.ready.bodyExisting"),
              readyCtaContinue: t("onboarding.wizard.ready.ctaContinue"),
              back: t("onboarding.wizard.back"),
              closeLabel: t("onboarding.wizard.close"),
              stepIndicator: (step, total) =>
                t("onboarding.wizard.stepIndicator", { step, total }),
            }}
            hasExistingProject={activePanes(gridState).length > 0}
            onOpenFirstProject={onboardingWizardOpenFirstProject}
            onSkip={onboardingWizardSkip}
            onStepChange={onboardingWizardStepViewed}
          />
        )}
      </div>
    </Tooltip.Provider>
  );
}

// macOS' NSOpenPanel stellt beim Öffnen sonst den zuletzt genutzten Ordner
// wieder her — liegt der auf einem langsam erreichbaren Pfad (Netzlaufwerk,
// ausgehängtes Volume, nicht vollständig heruntergeladener iCloud-Ordner),
// verzögert das JEDES Öffnen des Dialogs, nicht nur das erste (2026-08-12
// vom Nutzer live bestätigt). Ein expliziter `defaultPath` überspringt diese
// Wiederherstellung. `homeDir()` ist immer lokal und schnell auflösbar;
// schlägt die Auflösung selbst fehl, öffnet der Dialog wie zuvor ohne
// `defaultPath`, statt den Klick ins Leere laufen zu lassen.
//
// UNVERIFIZIERTE HYPOTHESE (2026-08-12): passt zur Nutzerbeobachtung (1a/2a),
// ist aber nicht gemessen. Nebenwirkung: der Dialog startet jetzt immer im
// Home-Verzeichnis statt beim zuletzt genutzten Ordner — falls sich das
// Delay-Problem dadurch nicht löst, diesen Block wieder entfernen statt die
// Ergonomie-Regression stehen zu lassen.
async function defaultProjectPickerPath(): Promise<string | undefined> {
  try {
    return await homeDir();
  } catch (error) {
    console.error(
      "PaneCrew: homeDir() für Ordnerauswahl fehlgeschlagen",
      error,
    );
    return undefined;
  }
}

export default App;
