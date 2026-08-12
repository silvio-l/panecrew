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
  restoringSlots,
  zoom,
  onAssignProject,
  onClosePane,
  onFocusPane,
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
  /** Für die Drop-Positionsprüfung (`useWebviewFileDrop.ts`) — physische
   * Drop-Koordinaten sind vom App-Zoom mitskaliert. */
  zoom: number;
  onAssignProject: (slotIndex: number) => void;
  onClosePane: (paneId: string) => void;
  onFocusPane: (paneId: string) => void;
}) {
  // Die eine Drag-Drop-Registrierung für das ganze Grid (Begründung dort).
  const dropTargets = useWebviewFileDrop(zoom);

  return (
    // Der Template-Wechsel ändert GENAU DIESE Klasse und sonst nichts am Baum
    // — Spuren und Spannen aller sieben Geometrien stehen in App.css
    // (`.pc-layout--*`), die Begründung dafür ebenfalls dort.
    <div className={`pc-workspace pc-layout--${state.template}`}>
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
            onFocus={() => onFocusPane(slot.paneId)}
          />
        ) : (
          <ProjectPicker
            key={`empty-slot-${index}`}
            onChoose={() => onAssignProject(index)}
            busy={pickingSlot === index}
            restoring={restoringSlots.has(index)}
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
  onFocus,
}: {
  paneId: string;
  projectPath: string;
  focused: boolean;
  editor: ReturnType<PaneFileEditors["editorFor"]>;
  guardLeave: (paneId: string, run: () => void) => void;
  dropTargets: PaneDropRegistration;
  onClose: () => void;
  onFocus: () => void;
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
          onFocus={onFocus}
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
