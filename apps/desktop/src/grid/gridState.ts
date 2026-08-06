// Reine Zustandsübergänge für das Grid (Ticket 03), im selben Schnitt wie
// `explorer/fileEditorState.ts`: kein React-, kein `@tauri-apps`-Import, keine
// ID-Erzeugung. `useGrid.ts` hält diesen State per `useState` und erzeugt
// `paneId`s — hier drin ist jede `paneId` ein bereits fertiger String.
//
// Die Slot-*Zahl* ist Store-Wissen (Invariante: `slots.length ===
// slotCount(template)`), die Slot-*Geometrie* (welche Zelle wo, welche
// breiter) lebt vollständig in CSS.

export type TemplateId =
  | "single"
  | "split"
  | "quad"
  | "two-over-one"
  | "one-over-two"
  | "row-3"
  | "row-4";

export interface GridTemplate {
  id: TemplateId;
  label: string;
  slotCount: number;
}

export const GRID_TEMPLATES: readonly GridTemplate[] = [
  { id: "single", label: "Einzeln", slotCount: 1 },
  { id: "split", label: "Geteilt", slotCount: 2 },
  { id: "two-over-one", label: "Zwei über eins", slotCount: 3 },
  { id: "one-over-two", label: "Eins über zwei", slotCount: 3 },
  { id: "row-3", label: "Dreierreihe", slotCount: 3 },
  { id: "quad", label: "Vierergrid", slotCount: 4 },
  { id: "row-4", label: "Viererreihe", slotCount: 4 },
];

export const DEFAULT_TEMPLATE: TemplateId = "quad";

export interface Pane {
  paneId: string;
  projectPath: string;
}

// Nicht exportiert, solange nichts außerhalb dieser Datei den Typ selbst
// braucht (nur seine Form über `GridState.slots`) — `PaneGrid.tsx` iteriert
// `state.slots` und lässt TS den Elementtyp ableiten.
type Slot = Pane | null;

export interface GridState {
  template: TemplateId;
  slots: readonly Slot[];
  focusedPaneId: string | null;
}

export const INITIAL_GRID_STATE: GridState = {
  template: DEFAULT_TEMPLATE,
  slots: [null, null, null, null],
  focusedPaneId: null,
};

function slotCount(template: TemplateId): number {
  const found = GRID_TEMPLATES.find((t) => t.id === template);
  // GRID_TEMPLATES deckt jede TemplateId ab — ein fehlender Eintrag wäre ein
  // Programmierfehler in dieser Datei, kein Laufzeitfall.
  if (!found) throw new Error(`Unbekanntes Template: ${template}`);
  return found.slotCount;
}

/** Belegte Slots in Reihenfolge (leere übersprungen). */
export function activePanes(state: GridState): readonly Pane[] {
  return state.slots.filter((slot): slot is Pane => slot !== null);
}

/**
 * `null`, wenn der Wechsel erlaubt ist, sonst eine Nachricht mit beiden
 * Zahlen. Wachsen (mehr Slots) ist immer erlaubt; Schrumpfen nur, wenn die
 * Zahl aktiver Panes in die Ziel-Slot-Zahl passt. Einzige Quelle für
 * Disabled-State *und* Erklärtext im Switcher.
 */
export function templateSwitchBlockReason(
  state: GridState,
  target: TemplateId,
): string | null {
  const targetSlots = slotCount(target);
  const active = activePanes(state).length;
  if (active <= targetSlots) return null;
  const targetLabel =
    GRID_TEMPLATES.find((t) => t.id === target)?.label ?? target;
  return `${active} aktive Panes passen nicht in ${targetLabel} (${targetSlots} ${
    targetSlots === 1 ? "Platz" : "Plätze"
  }).`;
}

/**
 * Blockiert → identische State-Referenz zurück (referenzgleich testbar, kein
 * Re-Render). Wechsel aufs aktuelle Template ist ebenfalls ein No-Op.
 *
 * Wachsen erhält bestehende Indizes (Array wird mit `null` aufgefüllt).
 * Schrumpfen ist zählungsbasiert, nicht indexbasiert: die aktiven Panes
 * rücken der Reihe nach (nach ursprünglichem Index stabil) in die neuen,
 * niedrigeren Indizes — eine Quad mit Panes an Index 0 und 3 wechselt zu
 * Split also zu `[pane0, pane3]`, nicht zu einem blockierten Versuch.
 */
export function switchTemplate(state: GridState, target: TemplateId): GridState {
  if (target === state.template) return state;
  if (templateSwitchBlockReason(state, target) !== null) return state;

  const targetSlots = slotCount(target);
  const nextSlots: Slot[] =
    targetSlots >= state.slots.length
      ? Array.from(
          { length: targetSlots },
          (_, i) => state.slots[i] ?? null,
        )
      : (() => {
          const compacted: Slot[] = new Array<Slot>(targetSlots).fill(null);
          activePanes(state).forEach((pane, i) => {
            compacted[i] = pane;
          });
          return compacted;
        })();

  return { template: target, slots: nextSlots, focusedPaneId: state.focusedPaneId };
}

/** Schreibt die Zuordnung, setzt `focusedPaneId` auf die neue Pane. Ein
 * ungültiger Index lässt den State unverändert (identische Referenz). */
export function assignProjectToSlot(
  state: GridState,
  slotIndex: number,
  projectPath: string,
  paneId: string,
): GridState {
  if (slotIndex < 0 || slotIndex >= state.slots.length) return state;
  const nextSlots = state.slots.slice();
  nextSlots[slotIndex] = { paneId, projectPath };
  return { ...state, slots: nextSlots, focusedPaneId: paneId };
}

/** Leert den Slot der übergebenen Pane. War sie fokussiert, fällt der Fokus
 * auf die erste verbleibende Pane in Slot-Reihenfolge zurück, sonst auf
 * `null`. Eine unbekannte `paneId` lässt den State unverändert. */
export function closePane(state: GridState, paneId: string): GridState {
  const index = state.slots.findIndex((slot) => slot?.paneId === paneId);
  if (index === -1) return state;

  const nextSlots = state.slots.slice();
  nextSlots[index] = null;

  const nextFocus =
    state.focusedPaneId === paneId
      ? (nextSlots.find((slot): slot is Pane => slot !== null)?.paneId ?? null)
      : state.focusedPaneId;

  return { ...state, slots: nextSlots, focusedPaneId: nextFocus };
}

/** Der Projektpfad der fokussierten Pane — das, worauf `ExplorerPanel`
 * bindet. `null`, solange keine Pane fokussiert ist. */
export function focusedProjectPath(state: GridState): string | null {
  return (
    state.slots.find((slot) => slot?.paneId === state.focusedPaneId)
      ?.projectPath ?? null
  );
}
