/*
 * DIRECTION CONTRACT — Panecrew Desktop-Hauptoberfläche
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
import { useState } from "react";
import { Tooltip } from "radix-ui";
import { TitleBar } from "./components/TitleBar";
import { ExplorerPanel } from "./components/ExplorerPanel";
import { TerminalPane } from "./components/TerminalPane";
import { projects } from "./mock/projects";
import "./App.css";

function App() {
  const [focusedId, setFocusedId] = useState(projects[0].id);
  const focusedProject =
    projects.find((p) => p.id === focusedId) ?? projects[0];

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          {/* Explorer folgt der fokussierten Pane; key erzwingt frischen
              Baum-State (Auswahl/Einklapp-Zustand) pro Projektwechsel. */}
          <ExplorerPanel key={focusedProject.id} project={focusedProject} />
          <main className="grid min-w-0 flex-1 grid-cols-2 grid-rows-2 gap-2 p-2">
            {projects.map((project) => (
              <TerminalPane
                key={project.id}
                project={project}
                focused={project.id === focusedId}
                onFocus={() => setFocusedId(project.id)}
              />
            ))}
          </main>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

export default App;
