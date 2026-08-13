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
  /** i18n-Schlüssel unterhalb von `templateSwitcher.templates` — kein
   * fertiger Text: dieses Modul bleibt bewusst frei von React-/i18next-
   * Importen (s. Kopfkommentar), die Übersetzung übernimmt der Aufrufer
   * (`TemplateSwitcher.tsx`), der ohnehin schon `useTranslation()` hält. */
  labelKey: string;
  slotCount: number;
}

export const GRID_TEMPLATES: readonly GridTemplate[] = [
  { id: "single", labelKey: "templateSwitcher.templates.single", slotCount: 1 },
  { id: "split", labelKey: "templateSwitcher.templates.split", slotCount: 2 },
  { id: "two-over-one", labelKey: "templateSwitcher.templates.twoOverOne", slotCount: 3 },
  { id: "one-over-two", labelKey: "templateSwitcher.templates.oneOverTwo", slotCount: 3 },
  { id: "row-3", labelKey: "templateSwitcher.templates.row3", slotCount: 3 },
  { id: "quad", labelKey: "templateSwitcher.templates.quad", slotCount: 4 },
  { id: "row-4", labelKey: "templateSwitcher.templates.row4", slotCount: 4 },
];

export const DEFAULT_TEMPLATE: TemplateId = "quad";

/** Ein Terminal-Tab einer Pane — je eine eigene PTY (Ticket 18). `tabId`
 * kommt wie `paneId` fertig von `useGrid.ts` (`crypto.randomUUID()`), dieses
 * Modul erzeugt keine IDs selbst (Kopfkommentar). */
interface TerminalTab {
  tabId: string;
}

export interface Pane {
  paneId: string;
  projectPath: string;
  /** Mindestens ein Eintrag, immer — ein Tab lässt sich nicht schließen,
   * solange er der letzte ist (`closeTerminalTab` unten), eine Pane ohne
   * Terminal-Tab wäre ein Zustand, den `activeTerminalTabId` nicht mehr
   * auflösen könnte. */
  terminalTabs: readonly TerminalTab[];
  /** Welcher Terminal-Tab beim Zurückwechseln vom File-Tab aktiv wird —
   * unabhängig davon, ob gerade `showingFile` gilt. Immer eine `tabId` aus
   * `terminalTabs`. */
  activeTerminalTabId: string;
  /** Ob gerade der File-Tab sichtbar ist statt eines Terminal-Tabs. Ob es
   * überhaupt einen File-Tab gibt, weiß dieses Modul nicht — das entscheidet
   * der Aufrufer (`usePaneFileEditors`, außerhalb dieses Schnitts), hier wird
   * nur die Sichtbarkeits-Absicht gehalten. */
  showingFile: boolean;
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

/** Die beiden Zahlen (plus der Ziel-Label-Schlüssel) hinter einer blockierten
 * Vorlagenumschaltung — der fertige Satz entsteht erst beim Aufrufer, der
 * `t()` zur Verfügung hat (s. `GridTemplate.labelKey`). */
export interface TemplateSwitchBlock {
  active: number;
  targetSlots: number;
  targetLabelKey: string;
}

/**
 * `null`, wenn der Wechsel erlaubt ist, sonst die Zahlen hinter der Sperre.
 * Wachsen (mehr Slots) ist immer erlaubt; Schrumpfen nur, wenn die Zahl
 * aktiver Panes in die Ziel-Slot-Zahl passt. Einzige Quelle für Disabled-State
 * *und* Erklärtext im Switcher.
 */
export function templateSwitchBlockReason(
  state: GridState,
  target: TemplateId,
): TemplateSwitchBlock | null {
  const targetSlots = slotCount(target);
  const active = activePanes(state).length;
  if (active <= targetSlots) return null;
  const targetLabelKey =
    GRID_TEMPLATES.find((t) => t.id === target)?.labelKey ?? target;
  return { active, targetSlots, targetLabelKey };
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

/** Schreibt die Zuordnung, setzt `focusedPaneId` auf die neue Pane. Die neue
 * Pane bekommt genau einen Terminal-Tab (`tabId`), sofort aktiv, kein
 * File-Tab. Ein ungültiger Index lässt den State unverändert (identische
 * Referenz). */
export function assignProjectToSlot(
  state: GridState,
  slotIndex: number,
  projectPath: string,
  paneId: string,
  tabId: string,
): GridState {
  if (slotIndex < 0 || slotIndex >= state.slots.length) return state;
  const nextSlots = state.slots.slice();
  nextSlots[slotIndex] = {
    paneId,
    projectPath,
    terminalTabs: [{ tabId }],
    activeTerminalTabId: tabId,
    showingFile: false,
  };
  return { ...state, slots: nextSlots, focusedPaneId: paneId };
}

/** Hängt einen weiteren Terminal-Tab an und macht ihn sofort aktiv (verlässt
 * dabei den File-Tab, falls gerade sichtbar) — der Zustandsübergang hinter
 * "weiteren Terminal-Tab öffnen". Eine unbekannte `paneId` lässt den State
 * unverändert. */
export function openTerminalTab(
  state: GridState,
  paneId: string,
  tabId: string,
): GridState {
  const index = state.slots.findIndex((slot) => slot?.paneId === paneId);
  if (index === -1) return state;
  const pane = state.slots[index] as Pane;

  const nextSlots = state.slots.slice();
  nextSlots[index] = {
    ...pane,
    terminalTabs: [...pane.terminalTabs, { tabId }],
    activeTerminalTabId: tabId,
    showingFile: false,
  };
  return { ...state, slots: nextSlots };
}

/** Schließt einen Terminal-Tab (beendet nur dessen PTY, nicht die Pane) —
 * der letzte verbleibende Terminal-Tab einer Pane lässt sich nicht
 * schließen (identische Referenz), ebenso eine unbekannte `paneId`/`tabId`.
 * War der geschlossene Tab aktiv, übernimmt sein Vorgänger in der Liste
 * (oder, an Position 0, sein Nachfolger). */
export function closeTerminalTab(
  state: GridState,
  paneId: string,
  tabId: string,
): GridState {
  const index = state.slots.findIndex((slot) => slot?.paneId === paneId);
  if (index === -1) return state;
  const pane = state.slots[index] as Pane;
  if (pane.terminalTabs.length <= 1) return state;

  const tabIndex = pane.terminalTabs.findIndex((tab) => tab.tabId === tabId);
  if (tabIndex === -1) return state;

  // nextTabs hat mindestens ein Element (Guard oben: terminalTabs.length > 1
  // vor dem Filtern), der Fallback-Zugriff auf Index 0 ist also nie leer.
  const nextTabs = pane.terminalTabs.filter((tab) => tab.tabId !== tabId);
  const fallbackTab = nextTabs[Math.max(tabIndex - 1, 0)] ?? nextTabs[0];
  const nextActiveTabId =
    pane.activeTerminalTabId === tabId
      ? (fallbackTab as TerminalTab).tabId
      : pane.activeTerminalTabId;

  const nextSlots = state.slots.slice();
  nextSlots[index] = {
    ...pane,
    terminalTabs: nextTabs,
    activeTerminalTabId: nextActiveTabId,
  };
  return { ...state, slots: nextSlots };
}

/** Wechselt zu einem Terminal-Tab derselben Pane (verlässt dabei den
 * File-Tab, falls gerade sichtbar). No-Op (identische Referenz) bei
 * unbekannter `paneId`/`tabId` oder wenn der Tab bereits aktiv ist und kein
 * File-Tab davor sichtbar war. */
export function switchToTerminalTab(
  state: GridState,
  paneId: string,
  tabId: string,
): GridState {
  const index = state.slots.findIndex((slot) => slot?.paneId === paneId);
  if (index === -1) return state;
  const pane = state.slots[index] as Pane;
  if (!pane.terminalTabs.some((tab) => tab.tabId === tabId)) return state;
  if (pane.activeTerminalTabId === tabId && !pane.showingFile) return state;

  const nextSlots = state.slots.slice();
  nextSlots[index] = { ...pane, activeTerminalTabId: tabId, showingFile: false };
  return { ...state, slots: nextSlots };
}

/** Wechselt zum File-Tab derselben Pane, ohne den aktiven Terminal-Tab zu
 * verändern (der bleibt der Rückkehrpunkt). Ob es überhaupt einen File-Tab
 * gibt, entscheidet der Aufrufer — dieses Modul kennt nur die
 * Sichtbarkeits-Absicht (s. `Pane.showingFile`). No-Op bei unbekannter
 * `paneId` oder wenn der File-Tab bereits sichtbar ist. */
export function switchToFileTab(state: GridState, paneId: string): GridState {
  const index = state.slots.findIndex((slot) => slot?.paneId === paneId);
  if (index === -1) return state;
  const pane = state.slots[index] as Pane;
  if (pane.showingFile) return state;

  const nextSlots = state.slots.slice();
  nextSlots[index] = { ...pane, showingFile: true };
  return { ...state, slots: nextSlots };
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

/** Setzt `focusedPaneId` auf `paneId` — der Zustandsübergang für einen Klick
 * in eine belegte Pane. Eine unbekannte `paneId` (Pane währenddessen
 * geschlossen, Klick auf einen leeren Slot) und der Fall, dass sie bereits
 * fokussiert ist, sind beides No-Ops (identische Referenz, kein Re-Render). */
export function focusPane(state: GridState, paneId: string): GridState {
  if (state.focusedPaneId === paneId) return state;
  if (!state.slots.some((slot) => slot?.paneId === paneId)) return state;
  return { ...state, focusedPaneId: paneId };
}

/** Der Projektpfad der fokussierten Pane — das, worauf `ExplorerPanel`
 * bindet. `null`, solange keine Pane fokussiert ist. */
export function focusedProjectPath(state: GridState): string | null {
  return (
    state.slots.find((slot) => slot?.paneId === state.focusedPaneId)
      ?.projectPath ?? null
  );
}
