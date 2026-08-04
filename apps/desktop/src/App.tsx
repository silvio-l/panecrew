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
 * line-height, one luminous blue accent reserved exclusively for focus.
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
 * project name; the single accent traces the focused pane's border as a
 * luminous glow (comp-2 material quality) and echoes in the explorer's
 * project header.
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
import { useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { Tooltip } from "radix-ui";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { TitleBar } from "./components/TitleBar";
import {
  CollapsedExplorerStrip,
  ExplorerPanel,
} from "./components/ExplorerPanel";
import { ProjectPicker } from "./components/ProjectPicker";
import { TerminalPane } from "./components/TerminalPane";
import { projectNameFromPath, type Project } from "./types/project";
import "./App.css";

const EXPLORER_MIN_WIDTH = 180;
const EXPLORER_MAX_WIDTH = 480;
const EXPLORER_DEFAULT_WIDTH = 224;

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [picking, setPicking] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT_WIDTH);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [resizingExplorer, setResizingExplorer] = useState(false);

  const chooseProject = () => {
    setPicking(true);
    void openFolderDialog({ directory: true, multiple: false })
      .then((selected) => {
        if (typeof selected !== "string") return;
        // Der echte Verzeichnis-Scan ist Ticket 04: der Baum bleibt hier
        // bewusst leer, statt erfundene Einträge zu zeigen.
        setProject({
          path: selected,
          name: projectNameFromPath(selected),
          selectedFile: "",
          tree: [],
        });
      })
      .catch((error: unknown) => {
        console.error("PaneCrew: Ordnerauswahl fehlgeschlagen", error);
      })
      .finally(() => setPicking(false));
  };

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
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
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
                onCollapse={() => setExplorerCollapsed(true)}
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
              // key = Projektpfad: ein Projektwechsel remountet die Pane und
              // fährt damit die alte PTY-Session sauber herunter (pty_kill im
              // Effekt-Cleanup), statt sie umzuhängen.
              <TerminalPane
                key={project.path}
                project={project}
                onClose={() => setProject(null)}
              />
            )}
          </main>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

export default App;
