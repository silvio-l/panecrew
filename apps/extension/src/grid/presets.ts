// Named grid layouts (`panecrew.savePreset` / `panecrew.loadPreset`) — a
// preset is just a template id plus the project path assigned to each slot,
// stored in `ExtensionContext.globalState` so presets survive across
// workspaces (a preset built in one project set is meaningful to reapply in
// another). Kept separate from `session/persistence.ts`'s own
// `ExtensionContext.workspaceState` session, which is the *current*,
// per-workspace, auto-restored grid rather than a named, user-saved one.
import type { GridState, TemplateId } from "./gridState";
import { INITIAL_GRID_STATE, assignProjectToSlot } from "./gridState";
import type { Memento as PresetsMemento } from "../vscodeMemento";
export type { PresetsMemento };

export interface GridPreset {
  name: string;
  template: TemplateId;
  /** One entry per occupied slot, `null` for an empty one — same shape as
   * `GridState.slots` but reduced to just what a preset needs to
   * reconstruct: the project path. Live pane/tab ids are re-generated on
   * load, never persisted (same reasoning as `sessionState.ts`'s own
   * persisted shape: ids are live-session identity, not saved state). */
  slots: (string | null)[];
}

const STORAGE_KEY = "panecrew.presets";

export function loadPresets(memento: PresetsMemento): GridPreset[] {
  return memento.get<GridPreset[]>(STORAGE_KEY) ?? [];
}

export async function savePreset(memento: PresetsMemento, name: string, state: GridState): Promise<void> {
  const preset: GridPreset = {
    name,
    template: state.template,
    slots: state.slots.map((pane) => pane?.projectPath ?? null),
  };
  const existing = loadPresets(memento).filter((p) => p.name !== name);
  await memento.update(STORAGE_KEY, [...existing, preset]);
}

export async function deletePreset(memento: PresetsMemento, name: string): Promise<void> {
  const existing = loadPresets(memento).filter((p) => p.name !== name);
  await memento.update(STORAGE_KEY, existing);
}

/** Rebuilds a `GridState` from a preset, generating fresh pane/tab ids via
 * the supplied `makeId` (kept injectable rather than importing
 * `crypto.randomUUID()` directly, matching `gridState.ts`'s own convention
 * of never generating ids itself). */
export function gridStateFromPreset(preset: GridPreset, makeId: () => string): GridState {
  return preset.slots.reduce<GridState>((state, projectPath, index) => {
    if (!projectPath) return state;
    return assignProjectToSlot(state, index, projectPath, makeId(), makeId());
  }, { ...INITIAL_GRID_STATE, template: preset.template, slots: preset.slots.map(() => null) });
}

export function presetProjectPaths(preset: GridPreset): string[] {
  return preset.slots.filter((path): path is string => path !== null);
}
