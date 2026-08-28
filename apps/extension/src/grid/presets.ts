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

interface PresetSlot {
  projectPath: string;
  /** Shell command sent once into the pane's terminal right after this
   * preset creates it fresh (Auto-Start, e.g. `.scratch/…`) — `null` leaves
   * it a plain login shell. Never sent into an adopted/already-tracked
   * terminal (`GridLayoutController.createdPaneIds()`'s own contract): a
   * preset only ever types into a terminal it just spawned, never into one
   * that might already be running something. */
  startupCommand: string | null;
}

export interface GridPreset {
  name: string;
  template: TemplateId;
  /** One entry per occupied slot, `null` for an empty one — same shape as
   * `GridState.slots` but reduced to just what a preset needs to
   * reconstruct: the project path (plus its optional startup command).
   * Live pane/tab ids are re-generated on load, never persisted (same
   * reasoning as `sessionState.ts`'s own persisted shape: ids are
   * live-session identity, not saved state). */
  slots: (PresetSlot | null)[];
}

const STORAGE_KEY = "panecrew.presets";

/** A preset saved before Auto-Start (2026-08-28) stored a slot as a bare
 * `string | null` project path — migrated on read into today's `PresetSlot`
 * shape with no startup command, so an old on-disk preset keeps loading
 * instead of breaking. */
function migrateSlot(slot: string | PresetSlot | null): PresetSlot | null {
  if (slot === null) return null;
  return typeof slot === "string" ? { projectPath: slot, startupCommand: null } : slot;
}

export function loadPresets(memento: PresetsMemento): GridPreset[] {
  const stored = memento.get<{ name: string; template: TemplateId; slots: (string | PresetSlot | null)[] }[]>(STORAGE_KEY) ?? [];
  return stored.map((preset) => ({ ...preset, slots: preset.slots.map(migrateSlot) }));
}

/** `startupCommands` is keyed by `Pane.paneId` (the caller already has a
 * live `GridState` with real panes to iterate — see `extension.ts`'s
 * `panecrew.savePreset` handler), not by project path: two occupied slots
 * could in principle share a project path, and `paneId` is the one
 * unambiguous identity `GridState.slots` actually offers. */
export async function savePreset(
  memento: PresetsMemento,
  name: string,
  state: GridState,
  startupCommands: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  const preset: GridPreset = {
    name,
    template: state.template,
    slots: state.slots.map((pane) =>
      pane ? { projectPath: pane.projectPath, startupCommand: startupCommands.get(pane.paneId) ?? null } : null,
    ),
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
  return preset.slots.reduce<GridState>((state, slot, index) => {
    if (!slot) return state;
    return assignProjectToSlot(state, index, slot.projectPath, makeId(), makeId());
  }, { ...INITIAL_GRID_STATE, template: preset.template, slots: preset.slots.map(() => null) });
}

export function presetProjectPaths(preset: GridPreset): string[] {
  return preset.slots.filter((slot): slot is PresetSlot => slot !== null).map((slot) => slot.projectPath);
}

/** Zips a preset's per-slot startup commands with the fresh `GridState`
 * `gridStateFromPreset` just built from it (same slot index, same order —
 * `gridStateFromPreset` never reorders or skips an occupied slot), keyed by
 * the freshly generated `paneId` so the caller can hand it straight to
 * `GridLayoutController.sendText`. Slots with no startup command are
 * omitted entirely. */
export function presetStartupCommands(preset: GridPreset, state: GridState): Map<string, string> {
  const commands = new Map<string, string>();
  preset.slots.forEach((slot, index) => {
    if (!slot?.startupCommand) return;
    const pane = state.slots[index];
    if (pane) commands.set(pane.paneId, slot.startupCommand);
  });
  return commands;
}
