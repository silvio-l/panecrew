/*
 * DIRECTION CONTRACT — PaneCrew Desktop-Hauptoberfläche
 * (Quelle: .impeccable/direction-contract-desktop.md, Stand 2026-08-04 nach
 * Comp-Konsolidierung. Mode: Operate. Canon-Pfad, vom Nutzer gepinnt.)
 *
 * THESIS: The screen belongs to the terminals. Chrome exists only to answer
 * two questions — which project is this pane, and which pane is live. Refuses
 * the editor-shell-with-terminal-drawer default.
 *
 * OWN-WORLD: VS Code's token grammar — warm-dark grounds (#1E1E1E family),
 * 1px hairline borders, 13px system-UI chrome type, ui-monospace terminal
 * text — softened by Warp's polish: gentle pane radii, relaxed terminal
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
 * file tree directly, no icon rail, no overlay — styled 1:1 after VS Code's
 * current explorer (folder chevrons, type-colored file icons, muted tree
 * foreground with brighter active entry); a slim VS-Code-style title bar
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
 * FORM: Canon path, user-pinned (VS Code grammar, Warp warmth); no seed
 * rolled. Comp-Konsolidierung (Nutzer-Freigabe 2026-08-04): Optik/Material
 * aus mocks/comp-2-overlay-explorer.png, Explorer-Struktur und dünne
 * Pane-Header aus mocks/comp-3-zero-chrome.png.
 *
 * STAND TICKET 03: Das 2x2-Raster des FIRST VIEWPORT steht — mit echten,
 * PTY-gestützten Panes, und als Default unter sieben wählbaren Geometrien
 * (Geometrie in App.css, Slot-Zahl in grid/gridState.ts). Der Akzent trägt
 * jetzt tatsächlich nur EINE Pane: den Rahmen der fokussierten.
 */
import { useEffect, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { Tooltip } from "radix-ui";
import { invoke } from "@tauri-apps/api/core";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { TITLE_BAR_ZONE_HEIGHT, TitleBar } from "./components/TitleBar";
import {
  CollapsedExplorerStrip,
  ExplorerPanel,
} from "./components/ExplorerPanel";
import { PaneGrid } from "./components/PaneGrid";
import { TemplateSwitcher } from "./components/TemplateSwitcher";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { fileNameFromPath } from "./explorer/filePath";
import { usePaneFileEditors } from "./explorer/usePaneFileEditors";
import { focusedProjectPath } from "./grid/gridState";
import { useGrid } from "./grid/useGrid";
import { useProjects } from "./projects/useProjects";
import { buildSessionState, restoredTemplate } from "./session/sessionState";
import { loadSession, saveSession } from "./session/sessionStore";
import { useAppZoom } from "./shortcuts/useAppZoom";
import "./App.css";

const EXPLORER_MIN_WIDTH = 180;
const EXPLORER_MAX_WIDTH = 480;
const EXPLORER_DEFAULT_WIDTH = 224;

function App() {
  // Destrukturiert wie `useProjects()`s Rückgabe: `assignProject`/
  // `closePane` sind in `useGrid.ts` per `useCallback` memoisiert, ein
  // `grid`-Objekt als Ganzes wäre dagegen bei jedem Render neu und risse
  // jeden `useEffect`, der eine der beiden Funktionen aufruft, mit sich.
  const { state: gridState, assignProject, closePane, switchTemplate } =
    useGrid();
  // `null`, solange keine Pane fokussiert ist (z. B. alle Slots leer beim
  // ersten Start) — jede Stelle unten, die eine `paneId` braucht, behandelt
  // das explizit, statt eine Pane vorzutäuschen, die es nicht gibt.
  const focusedPaneId = gridState.focusedPaneId;
  const focusedPath = focusedProjectPath(gridState);
  // Destrukturiert statt als `projects`-Objekt weitergereicht: `load`/
  // `refresh` sind eigene, stabile Bindungen (in `useProjects.ts` per
  // `useCallback` memoisiert) — das hält sie aus `useEffect`-Dep-Arrays
  // heraus, die sonst bei jeder Cache-Änderung neu feuern würden.
  const { projects: projectRecords, load: loadProject, refresh: refreshProject } =
    useProjects();
  // `project` ist abgeleitet, kein eigener State: die schwere `Project`-
  // Struktur (Baum, Git-Deko) lebt im pfad-geschlüsselten Cache, hier steht
  // nur noch, welches Projekt die fokussierte Pane gerade zeigt — der
  // Explorer bindet auf GENAU dieses Projekt.
  const project =
    focusedPath !== null ? (projectRecords[focusedPath] ?? null) : null;
  const [selectedFile, setSelectedFile] = useState<Record<string, string>>({});
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
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT_WIDTH);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [resizingExplorer, setResizingExplorer] = useState(false);
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
  // Der Editor der fokussierten Pane — das Rechteck der Editorfläche zeigt
  // immer nur sie. Ohne fokussierte Pane (leeres Grid) liest `editorFor("")`
  // denselben `IDLE_STATE` wie jede unbenutzte `paneId` — kein Sonderfall
  // nötig.
  const fileEditor = paneFileEditors.editorFor(focusedPaneId ?? "");
  const zoom = useAppZoom();

  // Halbes Freigabesignal für das Hauptfenster: es startet unsichtbar hinter dem
  // Splash und darf erst aufgedeckt werden, wenn hier etwas zu sehen ist. Rust
  // wartet zusätzlich auf das Ende des Splash-Videos.
  useEffect(() => {
    void invoke("main_ready");
  }, []);

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
      lastSelectedFile: string | null,
    ) => {
      const project = await loadProject(projectPath);
      if (isCancelled()) return;
      const paneId = assignProject(slotIndex, project.path);
      if (lastSelectedFile === null) return;
      setSelectedFile((current) => ({ ...current, [paneId]: lastSelectedFile }));
      paneFileEditors.editorFor(paneId).open(`${project.path}/${lastSelectedFile}`);
    };

    const run = async () => {
      const session = await loadSession();
      if (!isCancelled() && session) {
        switchTemplate(restoredTemplate(session));
        for (const [slotIndex, slot] of session.slots.entries()) {
          if (isCancelled() || slot === null) continue;
          await restoreSlot(slotIndex, slot.project_path, slot.last_selected_file);
        }
      }

      // `panecrew <pfad>` überspringt den Picker: Rust hat den Pfad schon
      // gegen das echte Dateisystem geprüft (existiert, ist ein
      // Verzeichnis), ein ungültiges/fehlendes Argument liefert hier einfach
      // `null` zurück. Landet immer in Slot 0, unabhängig davon, was die
      // Sitzung dort gerade wiederhergestellt hat.
      const launchPath = await invoke<string | null>("get_launch_project");
      if (!isCancelled() && launchPath) {
        const project = await loadProject(launchPath);
        if (!isCancelled()) assignProject(0, project.path);
      }

      if (!isCancelled()) setHydrated(true);
    };

    run().catch((error: unknown) => {
      console.error("PaneCrew: Sitzung konnte nicht wiederhergestellt werden", error);
      if (!isCancelled()) setHydrated(true);
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
  useEffect(() => {
    if (!hydrated) return;
    void saveSession(buildSessionState(gridState, selectedFile));
  }, [hydrated, gridState, selectedFile]);

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
      void openFolderDialog({ directory: true, multiple: false })
        .then((selected) =>
          typeof selected === "string" ? loadProject(selected) : null,
        )
        .then((next) => {
          if (!next) return;
          if (outgoing) paneFileEditors.forget(outgoing.paneId);
          assignProject(slotIndex, next.path);
        })
        .catch((error: unknown) => {
          console.error("PaneCrew: Ordnerauswahl fehlgeschlagen", error);
        })
        .finally(() => setPickingSlot(null));
    };
    if (outgoing) guardLeave(outgoing.paneId, proceed);
    else proceed();
  };

  // Schließt eine einzelne Pane — geguardet auf ihren eigenen ungespeicherten
  // Stand, unabhängig davon, was in den anderen Panes liegt.
  const closePaneGuarded = (paneId: string) =>
    guardLeave(paneId, () => {
      closePane(paneId);
      paneFileEditors.forget(paneId);
    });

  // Ein Klick auf eine Datei im Baum tut ab jetzt zweierlei: er markiert die
  // Zeile UND öffnet die Datei in der Editorfläche. Bewusst kein zusätzlicher
  // Doppelklick-Handler (Nutzerentscheidung, deckt sich mit Story 8 des
  // Tickets) — der bestehende Einfachklick-Pfad bekommt die zweite Wirkung.
  //
  // Der Baum führt seine Pfade projekt-relativ (`TreeRow` baut sie als
  // `${eltern}/${name}`, Tiefe 0 der bloße Name), `explorer_read_file` will
  // einen absoluten — zusammengesetzt wird genau hier, im selben Muster, das
  // die Anlege-Zeile des Explorers schon für `explorer_create_file` verwendet.
  const selectFile = (path: string) => {
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
      fileEditor.open(absolutePath);
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

  const nudgeExplorerWidth = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8;
    const delta =
      e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    if (delta === 0) return;
    e.preventDefault();
    setExplorerWidth((current) =>
      Math.min(
        EXPLORER_MAX_WIDTH,
        Math.max(EXPLORER_MIN_WIDTH, current + delta),
      ),
    );
  };

  const startExplorerResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startWidth = explorerWidth;
    setResizingExplorer(true);
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      setExplorerWidth(
        Math.min(
          EXPLORER_MAX_WIDTH,
          Math.max(EXPLORER_MIN_WIDTH, startWidth + ev.clientX - startX),
        ),
      );
    };
    const onUp = () => {
      setResizingExplorer(false);
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
        <TitleBar zoom={zoom} />
        {/* Die Titelzeile schwebt (absolut positioniert) über dieser Fläche,
            statt sie als Flow-Element nach unten zu drücken. Der Freiraum wird
            hier reserviert, damit nichts dauerhaft verdeckt ist — geteilt durch
            den Zoomfaktor, weil die Kapsel darüber physisch konstant bleibt. */}
        <div
          style={{ paddingTop: `${TITLE_BAR_ZONE_HEIGHT / zoom}px` }}
          className="flex min-h-0 flex-1"
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
                selectedFile={selectedFile[focusedPaneId ?? ""] ?? ""}
                dirtyFile={dirtyFile}
                onSelectFile={selectFile}
                onCollapse={() => setExplorerCollapsed(true)}
                onRefresh={refreshExplorer}
              />
              {/* tabIndex + Pfeiltasten, weil ein reiner Ziehgriff die
                  Explorer-Breite für Tastaturnutzer unerreichbar macht — das
                  ist die ARIA-Rolle "separator" in ihrer bedienbaren Form
                  (aria-valuenow/min/max gehören dann dazu). */}
              <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Explorer-Breite anpassen"
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
            </>
          )}
          <main className="flex min-w-0 flex-1 flex-col p-2">
            <TemplateSwitcher
              state={gridState}
              onSwitchTemplate={switchTemplate}
            />
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
              zoom={zoom}
              onAssignProject={assignProjectToSlot}
              onClosePane={closePaneGuarded}
            />
          </main>
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
      </div>
    </Tooltip.Provider>
  );
}

export default App;
