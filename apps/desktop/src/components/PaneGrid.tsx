// Platzhalter-Verdrahtung für das Grid (Ticket 03, Schritt 5 des Plans):
// funktional vollständig (vier unabhängige Panes, Picker pro leerem Slot,
// pane-genaue Datei-Editoren), aber bewusst UNGESTYLT — nur Quad, ein
// simples CSS-Grid ohne die restlichen sechs Templates. Die Geometrie für
// alle sieben Templates, den echten Pro-Slot-Picker und die
// fokussiert/unfokussiert-Tokens liefert der Opus-Durchgang (Schritt 8),
// ohne diese Verdrahtung anzufassen.
//
// Invariante (gilt für den finalen Opus-Umbau genauso): jede Zelle ist
// direktes Kind DIESES Grid-Containers, in einem flachen Array. Belegte
// Zellen sind nach `paneId` geschlüsselt, leere nach Slot-Index — nie ein
// pro-Region-Wrapper-`<div>`, der nach Slot-Index geschlüsselt ist, sonst
// würde eine spätere Kompaktierung (Ticket 03, Schritt 7) über einen
// Index-Key-Wechsel unmounten und per `usePtyTerminal`s Cleanup eine lebende
// PTY killen.
import type { PaneFileEditors } from "../explorer/usePaneFileEditors";
import type { GridState } from "../grid/gridState";
import {
  useWebviewFileDrop,
  type PaneDropRegistration,
} from "../terminal/useWebviewFileDrop";
import { projectNameFromPath } from "../types/project";
import { FileEditor } from "./FileEditor";
import { ProjectPicker } from "./ProjectPicker";
import { TerminalPane } from "./TerminalPane";

export function PaneGrid({
  state,
  paneFileEditors,
  guardLeave,
  pickingSlot,
  zoom,
  onAssignProject,
  onClosePane,
}: {
  state: GridState;
  paneFileEditors: PaneFileEditors;
  guardLeave: (paneId: string, run: () => void) => void;
  /** Welcher leere Slot gerade auf den Ordner-Dialog wartet — `null`, wenn
   * keiner. Der native Dialog ist ohnehin modal, es kann also nie mehr als
   * einer gleichzeitig sein. */
  pickingSlot: number | null;
  /** Für die Drop-Positionsprüfung (`useWebviewFileDrop.ts`) — physische
   * Drop-Koordinaten sind vom App-Zoom mitskaliert. */
  zoom: number;
  onAssignProject: (slotIndex: number) => void;
  onClosePane: (paneId: string) => void;
}) {
  // Die eine Drag-Drop-Registrierung für das ganze Grid (Begründung dort).
  const dropTargets = useWebviewFileDrop(zoom);

  return (
    <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2">
      {state.slots.map((slot, index) =>
        slot ? (
          <PaneCell
            key={slot.paneId}
            paneId={slot.paneId}
            projectPath={slot.projectPath}
            focused={slot.paneId === state.focusedPaneId}
            editor={paneFileEditors.editorFor(slot.paneId)}
            guardLeave={guardLeave}
            dropTargets={dropTargets}
            onClose={() => onClosePane(slot.paneId)}
          />
        ) : (
          <ProjectPicker
            key={`empty-slot-${index}`}
            onChoose={() => onAssignProject(index)}
            busy={pickingSlot === index}
          />
        ),
      )}
    </div>
  );
}

function PaneCell({
  paneId,
  projectPath,
  focused,
  editor,
  guardLeave,
  dropTargets,
  onClose,
}: {
  paneId: string;
  projectPath: string;
  focused: boolean;
  editor: ReturnType<PaneFileEditors["editorFor"]>;
  guardLeave: (paneId: string, run: () => void) => void;
  dropTargets: PaneDropRegistration;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      {/* Wie zuvor in App.tsx: die Pane bleibt gemountet, nur ausgeblendet —
          ein Unmount würde über `usePtyTerminal`s Cleanup `pty_kill` auslösen. */}
      <div
        hidden={editor.state.status !== "idle"}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TerminalPane
          paneId={paneId}
          projectPath={projectPath}
          projectName={projectNameFromPath(projectPath)}
          focused={focused}
          dropTargets={dropTargets}
          onClose={onClose}
        />
      </div>
      <FileEditor
        state={editor.state}
        dirty={editor.wouldLoseWork}
        onEdit={editor.editContent}
        onSave={editor.save}
        onClose={() => guardLeave(paneId, editor.close)}
      />
    </div>
  );
}
