// Persistence shell around the ported, framework-agnostic `sessionState.ts`
// (originally backed by a Tauri-side file store, `session_store.rs`). Here
// the same `SessionState` shape is backed by `ExtensionContext.workspaceState`
// instead — one key per workspace (VS Code already scopes `workspaceState` to
// the current workspace, so no extra namespacing is needed), matching what
// the desktop app's `sessionStore.ts` did with its own file-based backend.
//
// Persisted per the spec: grid layout (template + slots), per-pane
// workspace-folder assignment (`Pane.projectPath`, unchanged from the
// desktop shape), and last-focused pane (`GridState.focusedPaneId`, folded
// into the window's own state below since this extension has exactly one
// logical "window" per VS Code workspace — no multi-window concept the way
// the desktop app has).
import type { GridState } from "../grid/gridState";
import {
  buildWindowState,
  restoredClosedProjectPaths,
  restoredSlots,
  restoredSplitRatios,
  restoredTemplate,
  type SessionState,
} from "./sessionState";
import type { Memento as WorkspaceMemento } from "../vscodeMemento";
export type { WorkspaceMemento };

const STORAGE_KEY = "panecrew.session";

/** The one window label this extension ever persists under — VS Code has no
 * multi-window-per-workspace concept the way the desktop app's
 * `useWindowIdentity.ts` did, so there is exactly one logical window per
 * workspace and it needs no real identity beyond a constant key. */
const WINDOW_LABEL = "workspace";

function readRaw(memento: WorkspaceMemento): SessionState | undefined {
  return memento.get<SessionState>(STORAGE_KEY);
}

/** Persists the live grid (template, slots, split ratios, maximized pane) —
 * mirrors `buildWindowState` exactly, just written to `workspaceState`
 * instead of invoking a Tauri command. */
export async function saveSession(
  memento: WorkspaceMemento,
  grid: GridState,
  closedProjectPaths: readonly string[] = [],
): Promise<void> {
  const existing = readRaw(memento);
  const window = buildWindowState(WINDOW_LABEL, grid, closedProjectPaths);
  const next: SessionState = {
    ...(existing ?? { windows: [] }),
    windows: [window],
  };
  await memento.update(STORAGE_KEY, next);
}

export interface RestoredSession {
  template: GridState["template"];
  slots: ReturnType<typeof restoredSlots>;
  splitRatios: number[];
  closedProjectPaths: string[];
}

/** `null` when no session was ever saved for this workspace — callers should
 * fall back to `INITIAL_GRID_STATE` in that case, same as the desktop app's
 * own "no session.json yet" path. */
export function loadSession(memento: WorkspaceMemento): RestoredSession | null {
  const session = readRaw(memento);
  if (!session) return null;
  return {
    template: restoredTemplate(session, WINDOW_LABEL),
    slots: restoredSlots(session, WINDOW_LABEL),
    splitRatios: restoredSplitRatios(session, WINDOW_LABEL),
    closedProjectPaths: restoredClosedProjectPaths(session, WINDOW_LABEL),
  };
}

/** Clears any saved session for this workspace — used by "reset PaneCrew" /
 * onboarding-restart flows. */
export async function clearSession(memento: WorkspaceMemento): Promise<void> {
  await memento.update(STORAGE_KEY, undefined);
}
