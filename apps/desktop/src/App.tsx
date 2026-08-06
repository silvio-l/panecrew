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
 * STAND TICKET 02: Das 2x2-Raster im FIRST VIEWPORT ist noch nicht erreicht —
 * dieser Schritt zeigt bewusst GENAU EINE echte, PTY-gestützte Pane statt
 * vier gefälschter. Das Raster kommt in Ticket 03 mit echten Panes zurück,
 * die Fokus-/Explorer-Kopplung ist dafür strukturell schon angelegt.
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
import { FileEditor } from "./components/FileEditor";
import { ProjectPicker } from "./components/ProjectPicker";
import { TerminalPane } from "./components/TerminalPane";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { fileNameFromPath } from "./explorer/filePath";
import { usePaneFileEditors } from "./explorer/usePaneFileEditors";
import { useAppZoom } from "./shortcuts/useAppZoom";
import { gitDecorationsFromStatuses, type GitFileStatus } from "./types/gitStatus";
import {
  projectNameFromPath,
  treeNodesFromRaw,
  type Project,
  type RawTreeNode,
} from "./types/project";
import "./App.css";

const EXPLORER_MIN_WIDTH = 180;
const EXPLORER_MAX_WIDTH = 480;
const EXPLORER_DEFAULT_WIDTH = 224;

// Einzige Stelle, die einen Project aus einem Pfad baut — Picker-, CLI-Launch-
// und Refresh-Pfad rufen beide hierhin statt je eine eigene Implementierung
// zu pflegen. Ein gescheiterter Baum-Read scheitert bewusst nicht den ganzen
// Projektaufbau (das Projekt öffnet trotzdem, cwd fürs PTY ist ja da) —
// `treeError` trägt den Fehler stattdessen sichtbar weiter. Baum und
// Git-Status laufen parallel: unabhängige IPC-Aufrufe, keiner blockiert den
// anderen.
async function buildProject(path: string): Promise<Project> {
  const name = projectNameFromPath(path);
  const [tree, gitDecorations] = await Promise.all([
    readTree(path),
    readGitDecorations(path),
  ]);
  return { path, name, ...tree, gitDecorations };
}

async function readTree(
  path: string,
): Promise<Pick<Project, "tree" | "treeError">> {
  try {
    const raw = await invoke<RawTreeNode[]>("explorer_read_tree", {
      root: path,
    });
    return { tree: treeNodesFromRaw(raw), treeError: null };
  } catch (error) {
    console.error("PaneCrew: Dateibaum konnte nicht gelesen werden", error);
    return { tree: [], treeError: String(error) };
  }
}

// Kein Analogon zu `treeError`: ein Projekt, das kein Git-Repo ist (oder ein
// fehlendes `git`), ist kein Fehlerzustand des Explorers — das Backend
// (`git_status.rs`) liefert dafür schon eine leere Liste statt eines Fehlers,
// hier bleibt nur der Transport-Fall (IPC selbst schlägt fehl) abzufangen.
async function readGitDecorations(path: string) {
  try {
    const statuses = await invoke<GitFileStatus[]>("explorer_git_status", {
      root: path,
    });
    return gitDecorationsFromStatuses(statuses);
  } catch (error) {
    console.error("PaneCrew: Git-Status konnte nicht gelesen werden", error);
    return gitDecorationsFromStatuses([]);
  }
}

// Bis Schritt 4/5 dieses Plans (echte `paneId`s aus dem Grid-Store) gibt es
// nur diese eine Pane — der Schlüssel ist ein fixer Platzhalter, damit der
// Umbau von "eine Editor-Instanz" auf "Editor pro Pane" für sich allein
// verifizierbar bleibt, ohne zugleich das Grid zu verdrahten. Jede Stelle,
// die ihn braucht, liest ihn über `focusedPaneId` — die einzige Zeile, die
// beim Wechsel auf den echten Grid-Fokus ersetzt werden muss.
const SINGLE_PANE_ID = "single-pane";

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [selectedFile, setSelectedFile] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT_WIDTH);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [resizingExplorer, setResizingExplorer] = useState(false);
  const focusedPaneId = SINGLE_PANE_ID;
  // Liest Baum + Git-Status desselben Projekts neu, ohne die offene Datei-
  // auswahl anzutasten (anders als ein Projektwechsel). Der Vergleich im
  // Setter schützt vor einer veralteten Antwort, falls der Nutzer während des
  // Reads schon zu einem anderen Projekt gewechselt hat.
  //
  // Steht vor `usePaneFileEditors`, weil der Hook es als `onSaved` bekommt und
  // ein späteres `const` hier in seiner temporalen Totzone läge.
  const refreshExplorer = () => {
    if (project === null) return;
    const path = project.path;
    void buildProject(path).then((next) => {
      setProject((current) => (current?.path === path ? next : current));
    });
  };

  // Nach jedem erfolgreichen Schreiben Baum und Git-Deko neu lesen — sonst
  // stünde die Deko der eben gespeicherten Datei veraltet da: aus einer
  // unveränderten versionierten Datei macht genau dieses Schreiben ein „M".
  const paneFileEditors = usePaneFileEditors(refreshExplorer);
  // Der Editor der fokussierten Pane — das Rechteck der Editorfläche zeigt
  // immer nur sie.
  const fileEditor = paneFileEditors.editorFor(focusedPaneId);
  const zoom = useAppZoom();

  // Halbes Freigabesignal für das Hauptfenster: es startet unsichtbar hinter dem
  // Splash und darf erst aufgedeckt werden, wenn hier etwas zu sehen ist. Rust
  // wartet zusätzlich auf das Ende des Splash-Videos.
  useEffect(() => {
    void invoke("main_ready");
  }, []);

  // `panecrew <pfad>` überspringt den Picker: Rust hat den Pfad schon gegen
  // das echte Dateisystem geprüft (existiert, ist ein Verzeichnis), ein
  // ungültiges/fehlendes Argument liefert hier einfach `null` zurück und
  // landet ganz normal beim Picker.
  useEffect(() => {
    let cancelled = false;
    void invoke<string | null>("get_launch_project")
      .then((path) => (path ? buildProject(path) : null))
      .then((next) => {
        if (!cancelled && next) {
          setProject(next);
          setSelectedFile((current) => ({ ...current, [focusedPaneId]: "" }));
        }
      })
      .catch((error: unknown) => {
        console.error("PaneCrew: Start-Projekt konnte nicht gelesen werden", error);
      });
    return () => {
      cancelled = true;
    };
  }, [focusedPaneId]);

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

  const openProjectFromDialog = () => {
    setPicking(true);
    void openFolderDialog({ directory: true, multiple: false })
      .then((selected) =>
        typeof selected === "string" ? buildProject(selected) : null,
      )
      .then((next) => {
        if (!next) return;
        setProject(next);
        setSelectedFile((current) => ({ ...current, [focusedPaneId]: "" }));
        // Eine offene Datei gehört immer zum Projekt, aus dem sie kam — sie
        // darf den Wechsel nicht überleben, sonst stünde nach dem Öffnen des
        // neuen Projekts weiter eine fremde Datei über dessen Terminal.
        fileEditor.close();
      })
      .catch((error: unknown) => {
        console.error("PaneCrew: Ordnerauswahl fehlgeschlagen", error);
      })
      .finally(() => setPicking(false));
  };

  // Gefragt wird VOR dem Ordner-Dialog des Systems, nicht danach: hinter dem
  // nativen Fenster stünde die Rückfrage plötzlich zwischen „Ordner gewählt"
  // und „Projekt offen", also mitten in einer Handlung, die der Nutzer für
  // abgeschlossen hält.
  //
  // Heute erreicht diese Rückfrage niemand: `chooseProject` hängt allein am
  // Projekt-Picker, und den sieht man nur ohne offenes Projekt — dann ist auch
  // keine Datei offen. Der Guard steht trotzdem, weil er einer der drei im
  // Ticket benannten Verlassen-Wege ist und mit dem Raster (mehrere Projekte
  // gleichzeitig) unmittelbar erreichbar wird.
  const chooseProject = () => guardLeave(focusedPaneId, openProjectFromDialog);

  // Zurück zum Picker. Schließt die Editorfläche mit: ihr Zustand lebt in App
  // und überlebt das Ausblenden der Pane sonst unsichtbar bis zur nächsten
  // Projektwahl. Ebenfalls geguardet und ebenfalls heute nicht erreichbar,
  // solange eine Datei offen ist: die Editorfläche verdeckt dann die Pane
  // samt ihrem Schließkreuz (`hidden`).
  const closeProject = () =>
    guardLeave(focusedPaneId, () => {
      setProject(null);
      fileEditor.close();
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
    if (project === null) {
      setSelectedFile((current) => ({ ...current, [focusedPaneId]: path }));
      return;
    }
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
                selectedFile={selectedFile[focusedPaneId] ?? ""}
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
            {project === null ? (
              <ProjectPicker onChoose={chooseProject} busy={picking} />
            ) : (
              <>
                {/* Eine offene Datei übernimmt vorübergehend das Rechteck der
                    Pane (Nutzerentscheidung 2026-08-06, Begründung in
                    FileEditor.tsx) — die Pane wird dabei aber NUR AUSGEBLENDET,
                    nie ausgehängt: der Effekt-Cleanup von `usePtyTerminal`
                    ruft `pty_kill`, ein Unmount würde also die echte
                    Shell-Sitzung samt laufendem Agenten töten. Das
                    hidden-Attribut ist dafür der ehrliche Weg — es nimmt die
                    Pane zugleich aus dem Zugänglichkeitsbaum, während ihr DOM
                    (und damit xterm.js) unangetastet stehen bleibt. Der
                    ResizeObserver im Hook misst beim Wiedereinblenden von
                    selbst nach und meldet die Geometrie ans PTY.

                    key = Projektpfad: ein Projektwechsel remountet die Pane
                    und fährt damit die alte PTY-Session sauber herunter,
                    statt sie umzuhängen. */}
                <div
                  hidden={fileEditor.state.status !== "idle"}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <TerminalPane
                    key={project.path}
                    project={project}
                    onClose={closeProject}
                  />
                </div>
                <FileEditor
                  state={fileEditor.state}
                  dirty={fileEditor.wouldLoseWork}
                  onEdit={fileEditor.editContent}
                  onSave={fileEditor.save}
                  // Das Schließkreuz der Fläche verlässt die Datei genauso wie
                  // ein Klick auf eine andere Zeile im Baum — geguardet wird
                  // deshalb hier an der Übergabe und nicht in FileEditor.tsx:
                  // die Fläche zeigt eine Datei an, sie entscheidet nicht, was
                  // ein Verlassen kostet.
                  onClose={() => guardLeave(focusedPaneId, fileEditor.close)}
                />
              </>
            )}
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
