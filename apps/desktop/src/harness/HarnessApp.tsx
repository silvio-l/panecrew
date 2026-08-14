import { useMemo, useState } from "react";
import { Tooltip } from "radix-ui";
import { TITLE_BAR_ZONE_HEIGHT, TitleBar } from "../components/TitleBar";
import { ExplorerPanel } from "../components/ExplorerPanel";
import { FocusPinHeader } from "../components/FocusPinHeader";
import { FocusTrace } from "../components/FocusTrace";
import { PaneGrid } from "../components/PaneGrid";
import { usePaneFileEditors } from "../explorer/usePaneFileEditors";
import { activePanes, focusedProjectPath } from "../grid/gridState";
import { useFocusRotation } from "../grid/useFocusRotation";
import { useGrid } from "../grid/useGrid";
import { PtyBackendContext } from "../terminal/ptyBackend";
import type { PaneDropRegistration } from "../terminal/useWebviewFileDrop";
import { projectNameFromPath } from "../types/project";
import { createDemoPtyBackend } from "./demoPtyBackend";
import { mockProject, mockProjectPath } from "./mockProjects";
import { parseStoryboard, type Storyboard } from "./storyboard";
import { useStoryboardPlayer } from "./useStoryboardPlayer";
import demoStoryboardJson from "./storyboards/demo.json";

// Der Demo-Harness (ADR-0001): dev-only Route, die dieselben Chrome-
// Komponenten wie App.tsx real mountet (Titelleiste, Grid, Explorer), aber
// von einem Storyboard statt von echten Nutzeraktionen gesteuert wird — kein
// Ordner-Dialog, kein `session.json`-Restore, keine echte PTY.
//
// Bewusst KEINE `session.json`-Fixture (Ticket 01, Story 5): eine Fixture
// bindet die Wiedergabe an einen konkreten, auf der Drehmaschine vorbereiteten
// Plattenzustand (Pfade, die dort existieren müssen). Das Storyboard beschreibt
// stattdessen nur simulierte Projekt-Namen (`mockProjects.ts`) — dieselbe
// Aufnahme läuft dadurch auf jeder Maschine identisch, ohne vorbereitete
// Ordner auf der Platte.
const EXPLORER_WIDTH = 224;

// Beide Drop-Wege (Finder-Drop, Ziehen aus dem Explorer) liegen im Harness
// bewusst tot. Der Harness spielt ein Storyboard ab — es gibt keinen echten
// Zeiger, der etwas zöge — und `useWebviewFileDrop` spräche Tauris
// Webview-API an, die es im reinen Vite-Harness gar nicht gibt.
const INERT_DROP_TARGETS: PaneDropRegistration = {
  register: () => undefined,
  unregister: () => undefined,
  paneAtPoint: () => null,
  insertInto: () => undefined,
};

const DEFAULT_STORYBOARD: Storyboard = parseStoryboard(demoStoryboardJson);

export function HarnessApp({
  storyboard = DEFAULT_STORYBOARD,
}: {
  storyboard?: Storyboard;
}) {
  const [demoBackend] = useState(createDemoPtyBackend);
  const grid = useGrid();
  const paneFileEditors = usePaneFileEditors(() => undefined);

  const projects = useMemo(() => {
    const byPath: Record<string, ReturnType<typeof mockProject>> = {};
    for (const pane of storyboard.panes) {
      const project = mockProject(pane.projectName);
      byPath[project.path] = project;
    }
    return byPath;
    // Ein einziges statisches Storyboard pro Harness-Lauf (Kopfkommentar) —
    // `storyboard` selbst ist referenzstabil (Prop-Default oder vom
    // Aufrufer memoisiert).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useStoryboardPlayer(storyboard, {
    assignPane: (slot, projectName) =>
      grid.assignProject(slot, mockProjectPath(projectName)),
    focusPane: grid.focusPane,
    typeInto: (tabId, text) => {
      demoBackend.emit(tabId, text);
    },
    switchTemplate: grid.switchTemplate,
  });

  const focusedPath = focusedProjectPath(grid.state);
  const project = focusedPath !== null ? (projects[focusedPath] ?? null) : null;
  // Fokus-Modus-Rotation gibt es im Harness nur der Vollständigkeit halber
  // (Storyboards steuern Panes selbst, nie per Rotation) — derselbe Hook wie
  // in App.tsx, ohne eigene Bedienung drumherum.
  const harnessMaximizedPane = activePanes(grid.state).find(
    (pane) => pane.paneId === grid.state.maximizedPaneId,
  );
  const focusRotation = useFocusRotation({
    maximizedPaneId: grid.state.maximizedPaneId,
    activeTabId: harnessMaximizedPane?.activeTerminalTabId ?? null,
    occupiedPanesInOrder: activePanes(grid.state).map((pane) => ({
      paneId: pane.paneId,
      tabIds: pane.terminalTabs.map((tab) => tab.tabId),
    })),
    onRotate: (next) => {
      grid.enterFocusMode(next.paneId);
      grid.switchToTerminalTab(next.paneId, next.tabId);
    },
  });

  return (
    <PtyBackendContext.Provider value={demoBackend}>
      <Tooltip.Provider delayDuration={300}>
        <div className="relative flex h-full flex-col">
          <TitleBar zoom={1} />
          {/* `relative`: Anker fürs FocusTrace-Overlay, s. App.tsx. Der
              Harness hat keinen Resize-Separator (keine echte Explorer-
              Breitenbedienung), der Pin-Header dockt hier direkt hinter dem
              Explorer an derselben Naht an. */}
          <div
            style={{ paddingTop: `${TITLE_BAR_ZONE_HEIGHT}px` }}
            className="relative flex min-h-0 flex-1"
          >
            {project !== null && (
              <>
                <ExplorerPanel
                  key={project.path}
                  project={project}
                  width={EXPLORER_WIDTH}
                  selectedFile=""
                  dirtyFile={null}
                  onExpandedChange={() => undefined}
                  onSelectFile={() => undefined}
                  onCollapse={() => undefined}
                  onRefresh={() => undefined}
                  onLoadChildren={() => Promise.resolve()}
                  onStartPathDrag={() => undefined}
                  draggingPath={null}
                  onConsumeDragClick={() => false}
                  onEntryRenamed={() => undefined}
                  onEntryDeleted={() => undefined}
                />
                <FocusPinHeader
                  pins={grid.state.slots.flatMap((slot, index) =>
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
                  focusedPaneId={grid.state.focusedPaneId}
                  onFocusPane={grid.focusPane}
                />
              </>
            )}
            <main className="flex min-w-0 flex-1 flex-col p-2">
              <PaneGrid
                state={grid.state}
                paneFileEditors={paneFileEditors}
                guardLeave={(_paneId, run) => run()}
                pickingSlot={null}
                restoringSlots={new Set()}
                dropTargets={INERT_DROP_TARGETS}
                dragTargetPaneId={null}
                // Storyboard-getriebene Panes klicken sich nie selbst zu —
                // ein leerer Slot bleibt im Harness leer.
                onAssignProject={() => undefined}
                onClosePane={grid.closePane}
                onSwapPanes={grid.swapPanes}
                onFocusPane={grid.focusPane}
                onOpenTerminalTab={grid.openTerminalTab}
                onCloseTerminalTab={grid.closeTerminalTab}
                onRenameTerminalTab={grid.renameTerminalTab}
                onSwitchToTerminalTab={grid.switchToTerminalTab}
                onSwitchToFileTab={grid.switchToFileTab}
                onEnterFocusMode={grid.enterFocusMode}
                onExitFocusMode={grid.exitFocusMode}
                rotation={focusRotation}
              />
            </main>
            {project !== null && (
              <FocusTrace
                focusedPaneId={grid.state.focusedPaneId}
                template={grid.state.template}
                slots={grid.state.slots}
                maximizedPaneId={grid.state.maximizedPaneId}
              />
            )}
          </div>
        </div>
      </Tooltip.Provider>
    </PtyBackendContext.Provider>
  );
}
