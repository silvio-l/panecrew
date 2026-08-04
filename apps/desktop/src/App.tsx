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
 */
import { useEffect, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Tooltip } from "radix-ui";
import { TitleBar } from "./components/TitleBar";
import {
  CollapsedExplorerStrip,
  ExplorerPanel,
} from "./components/ExplorerPanel";
import { TerminalPane, type PaneZoom } from "./components/TerminalPane";
import { projects } from "./mock/projects";
import "./App.css";

const EXPLORER_MIN_WIDTH = 180;
const EXPLORER_MAX_WIDTH = 480;
const EXPLORER_DEFAULT_WIDTH = 224;

function App() {
  const [focusedId, setFocusedId] = useState(projects[0].id);
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT_WIDTH);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [resizingExplorer, setResizingExplorer] = useState(false);
  const [zoom, setZoom] = useState<{ id: string; mode: PaneZoom } | null>(null);
  const focusedProject =
    projects.find((p) => p.id === focusedId) ?? projects[0];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  const toggleZoom = (id: string, mode: PaneZoom) =>
    setZoom((prev) =>
      prev?.id === id && prev.mode === mode ? null : { id, mode },
    );

  // Zoom via explizite Grid-Platzierung: die gezoomte Pane spannt Zeile
  // und/oder Spalte auf und überdeckt die Nachbarn (z-10) — alle Panes
  // bleiben gemountet, ihr State überlebt.
  const paneStyle = (id: string, index: number): CSSProperties => {
    const mode = zoom?.id === id ? zoom.mode : null;
    return {
      gridColumn:
        mode === "width" || mode === "max" ? "1 / -1" : `${(index % 2) + 1}`,
      gridRow:
        mode === "height" || mode === "max"
          ? "1 / -1"
          : `${Math.floor(index / 2) + 1}`,
      zIndex: mode ? 10 : undefined,
    };
  };

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          {explorerCollapsed ? (
            <CollapsedExplorerStrip
              onExpand={() => setExplorerCollapsed(false)}
            />
          ) : (
            <>
              {/* Explorer folgt der fokussierten Pane; key erzwingt frischen
                  Baum-State (Auswahl/Einklapp-Zustand) pro Projektwechsel. */}
              <ExplorerPanel
                key={focusedProject.id}
                project={focusedProject}
                width={explorerWidth}
                onCollapse={() => setExplorerCollapsed(true)}
              />
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Explorer-Breite anpassen"
                onPointerDown={startExplorerResize}
                onDoubleClick={() => setExplorerCollapsed(true)}
                className={`relative z-10 -ml-[3px] w-[5px] shrink-0 cursor-col-resize transition-colors duration-150 ${
                  resizingExplorer
                    ? "bg-(--pc-focusBorder)"
                    : "bg-transparent hover:bg-(--pc-focusBorder)/45"
                }`}
              />
            </>
          )}
          <main className="grid min-w-0 flex-1 grid-cols-2 grid-rows-2 gap-2 p-2">
            {projects.map((project, index) => (
              <TerminalPane
                key={project.id}
                project={project}
                focused={project.id === focusedId}
                onFocus={() => setFocusedId(project.id)}
                zoom={zoom?.id === project.id ? zoom.mode : null}
                onToggleZoom={(mode) => toggleZoom(project.id, mode)}
                style={paneStyle(project.id, index)}
              />
            ))}
          </main>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

export default App;
