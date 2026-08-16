// Reine Zustandsübergänge für das Grid (Ticket 03), im selben Schnitt wie
// `explorer/fileEditorState.ts`: kein React-, kein `@tauri-apps`-Import, keine
// ID-Erzeugung. `useGrid.ts` hält diesen State per `useState` und erzeugt
// `paneId`s — hier drin ist jede `paneId` ein bereits fertiger String.
//
// Die Slot-*Zahl* ist Store-Wissen (Invariante: `slots.length ===
// slotCount(template)`), die Slot-*Geometrie* (welche Zelle wo, welche
// breiter) lebt vollständig in CSS. Die Track-*Form* (Spalten×Zeilen, s.
// `GridTemplate.columns`/`.rows`) ist seit Ticket 21 (Schnittkanten-Splitter)
// die eine Ausnahme: `grid/splitRatios.ts`s reine Resize-/Positions-Mathematik
// und `components/GridSplitters.tsx`s Rendering brauchen diese Zahl, ohne sie
// aus `templateGlyph.css`s Klassennamen zurückzulesen — die CSS-Datei bleibt
// trotzdem die Quelle der TATSÄCHLICHEN `grid-template-columns/rows`-Werte,
// diese Zahlen hier sind nur ihr Duplikat als Store-Wissen.

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
  /** Spalten × Zeilen der `grid-template-columns/rows`-Spuren in
   * `templateGlyph.css`s `.pc-layout--<id>` — Duplikat, nicht Quelle (s.
   * Kopfkommentar). Zusammen mit `slotCount` UNABHÄNGIG: `two-over-one`/
   * `one-over-two` haben 3 Slots auf einem 2×2-Traster (eine Zelle spannt
   * zwei Tracks, `templateGlyph.css`s `grid-area`-Override). */
  columns: number;
  rows: number;
}

export const GRID_TEMPLATES: readonly GridTemplate[] = [
  { id: "single", labelKey: "templateSwitcher.templates.single", slotCount: 1, columns: 1, rows: 1 },
  { id: "split", labelKey: "templateSwitcher.templates.split", slotCount: 2, columns: 2, rows: 1 },
  { id: "two-over-one", labelKey: "templateSwitcher.templates.twoOverOne", slotCount: 3, columns: 2, rows: 2 },
  { id: "one-over-two", labelKey: "templateSwitcher.templates.oneOverTwo", slotCount: 3, columns: 2, rows: 2 },
  { id: "row-3", labelKey: "templateSwitcher.templates.row3", slotCount: 3, columns: 3, rows: 1 },
  { id: "quad", labelKey: "templateSwitcher.templates.quad", slotCount: 4, columns: 2, rows: 2 },
  { id: "row-4", labelKey: "templateSwitcher.templates.row4", slotCount: 4, columns: 4, rows: 1 },
];

export const DEFAULT_TEMPLATE: TemplateId = "quad";

/** Ein Terminal-Tab einer Pane — je eine eigene PTY (Ticket 18). `tabId`
 * kommt wie `paneId` fertig von `useGrid.ts` (`crypto.randomUUID()`), dieses
 * Modul erzeugt keine IDs selbst (Kopfkommentar).
 *
 * `label` ist die Nutzer-Umbenennung (`renameTerminalTab` unten) — `null`
 * heißt "kein eigener Name", der Chip zeigt dann nur seine Nummer
 * (`PaneTabs.tsx`). Nicht exportiert (wie das modulinterne `Slot` unten) —
 * `sessionState.ts`/`App.tsx` lesen `label` strukturell über `Pane`, ohne den
 * Typnamen selbst zu brauchen. */
interface TerminalTab {
  tabId: string;
  label: string | null;
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
  /** Fokus-Modus (Ticket 19): die eine Pane, die gerade das gesamte Grid
   * einnimmt, orthogonal zum Template — `null` heißt "kein Fokus-Modus
   * aktiv". Die übrigen Panes bleiben in `slots` unverändert (samt ihrer
   * Terminal-Tabs/PTYs), nur ihre Sichtbarkeit ändert sich beim Rendern
   * (`PaneGrid.tsx`), nicht ihr Zustand hier. */
  maximizedPaneId: string | null;
  /** Track-Verhältnisse der Schnittkanten des aktuellen Templates (Ticket 21)
   * — flach kodiert, Spalten-Anteile vor Zeilen-Anteilen (`grid/
   * splitRatios.ts`s Kopfkommentar). Leer heißt "Template-Default verwenden",
   * dieselbe Semantik wie `sessionState.ts`s `PersistedWindow.split_ratios`.
   * `switchTemplate` setzt sie IMMER auf leer zurück — ein Verhältnis für
   * eine andere Track-Form wäre bedeutungslos. */
  splitRatios: readonly number[];
}

export const INITIAL_GRID_STATE: GridState = {
  template: DEFAULT_TEMPLATE,
  slots: [null, null, null, null],
  focusedPaneId: null,
  maximizedPaneId: null,
  splitRatios: [],
};

function slotCount(template: TemplateId): number {
  const found = GRID_TEMPLATES.find((t) => t.id === template);
  // GRID_TEMPLATES deckt jede TemplateId ab — ein fehlender Eintrag wäre ein
  // Programmierfehler in dieser Datei, kein Laufzeitfall.
  if (!found) throw new Error(`Unbekanntes Template: ${template}`);
  return found.slotCount;
}

/** Spalten × Zeilen eines Templates (`GridTemplate.columns`/`.rows`) — die
 * eine Stelle, die `grid/splitRatios.ts`s reine Funktionen und
 * `components/GridSplitters.tsx` dafür brauchen. */
export function trackShape(template: TemplateId): { columns: number; rows: number } {
  const found = GRID_TEMPLATES.find((t) => t.id === template);
  if (!found) throw new Error(`Unbekanntes Template: ${template}`);
  return { columns: found.columns, rows: found.rows };
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

  // Schrumpfen lässt per `templateSwitchBlockReason` oben nie eine aktive
  // Pane verschwinden, die maximierte eingeschlossen — trotzdem defensiv
  // geprüft statt vorausgesetzt: eine fremde/veraltete Aufrufreihenfolge darf
  // keinen `maximizedPaneId` stehen lassen, der auf keinen Slot mehr zeigt.
  const nextMaximized = nextSlots.some(
    (slot) => slot?.paneId === state.maximizedPaneId,
  )
    ? state.maximizedPaneId
    : null;

  return {
    template: target,
    slots: nextSlots,
    focusedPaneId: state.focusedPaneId,
    maximizedPaneId: nextMaximized,
    // Ein Verhältnis für die ALTE Track-Form wäre auf der neuen bedeutungslos
    // (andere Spurenzahl, andere Indizes) — immer zurück auf "Default
    // verwenden", nie ein Best-Effort-Remapping.
    splitRatios: [],
  };
}

/**
 * Das nächstkleinere Wachstum ab dem aktuellen Template — erste
 * `GRID_TEMPLATES`-Zeile mit mehr Slots als jetzt, oder `null` an der
 * Obergrenze (`quad`/`row-4`, beide vier). Genau ein Slot mehr: die Tabelle
 * hat keine Lücke zwischen benachbarten Slot-Zahlen (1, 2, 3, 3, 3, 4, 4).
 * Bei mehreren Templates mit derselben Ziel-Slot-Zahl (die drei Dreier)
 * entscheidet die Tabellenreihenfolge — ein "Pane teilen"-Kürzel kann nicht
 * fragen, welches gemeint ist, es braucht ein einziges, vorhersagbares Ziel.
 */
export function nextGrowthTemplate(current: TemplateId): TemplateId | null {
  const currentSlots = slotCount(current);
  return (
    GRID_TEMPLATES.find((template) => template.slotCount > currentSlots)?.id ??
    null
  );
}

/** Schreibt die Schnittkanten-Verhältnisse des aktuellen Templates (Ticket
 * 21) — reiner Setter, die Anteile selbst berechnet der Aufrufer
 * (`grid/splitRatios.ts`s `resizeAxisRatios`/`normalizeRatios`, dieses Modul
 * bleibt frei von Pixel-/DOM-Wissen). Keine Validierung gegen die Track-Form
 * hier: `normalizeRatios` beim Restore und `resizeAxisRatios` beim Live-Drag
 * garantieren beide bereits eine passende Länge. */
export function setSplitRatios(
  state: GridState,
  splitRatios: readonly number[],
): GridState {
  return { ...state, splitRatios };
}

/** Index des ersten LEEREN Slots in Template-Reihenfolge, -1 wenn das Grid
 * komplett voll ist. Die eine Stelle, an der "ist noch Platz im Grid?"
 * entschieden wird — `App.tsx`s menü-/tastaturkürzel-getriebenes "Ordner
 * öffnen …"/"Zuletzt geöffnet" zielt NUR je auf einen leeren Slot, NIEMALS
 * auf einen belegten (Bugfix 2026-08-16: ein Öffnen über diesen Weg darf
 * niemals stillschweigend eine laufende, unbeteiligte Pane ersetzen — bei
 * -1 fragt `App.tsx` stattdessen nach, ob PaneCrew das Projekt in einem
 * neuen Fenster öffnen soll). Ein direkter Klick auf einen konkreten Slot
 * (leer oder belegt, `onAssignProject`/Drag&Drop) geht NICHT über diese
 * Funktion — dort ist der Zielslot bereits eindeutig vom Nutzer gewählt. */
export function firstEmptySlotIndex(state: GridState): number {
  return state.slots.findIndex((slot) => slot === null);
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
    terminalTabs: [{ tabId, label: null }],
    activeTerminalTabId: tabId,
    showingFile: false,
  };
  return { ...state, slots: nextSlots, focusedPaneId: paneId };
}

/**
 * Tauscht zwei belegte Slots (Ticket 20) — die Template-Topologie bleibt
 * dabei per Konstruktion unberührt: es wird nur der Inhalt zweier Positionen
 * im `slots`-Array vertauscht, nie dessen Länge oder das Template.
 *
 * Warum ausschließlich belegt↔belegt: ein Drop auf einen LEEREN Slot ist
 * bereits der bestehende Picker-Fluss (`assignProjectToSlot`), und ein
 * "Verschieben statt Tauschen" dorthin hätte eine zweite, konkurrierende
 * Bedeutung für dieselbe Geste. Ein leerer Slot ist hier deshalb No-Op
 * (identische Referenz), ebenso ein ungültiger Index und der Tausch einer
 * Pane mit sich selbst.
 *
 * `focusedPaneId`/`maximizedPaneId` bleiben bewusst unangetastet: beide
 * zeigen auf `paneId`s, nicht auf Positionen — wer fokussiert war, ist es
 * nach dem Tausch weiterhin, nur an anderer Stelle im Grid.
 */
export function swapPanes(
  state: GridState,
  indexA: number,
  indexB: number,
): GridState {
  if (indexA === indexB) return state;
  if (indexA < 0 || indexA >= state.slots.length) return state;
  if (indexB < 0 || indexB >= state.slots.length) return state;

  const paneA = state.slots[indexA];
  const paneB = state.slots[indexB];
  if (!paneA || !paneB) return state;

  const nextSlots = state.slots.slice();
  nextSlots[indexA] = paneB;
  nextSlots[indexB] = paneA;
  return { ...state, slots: nextSlots };
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
    terminalTabs: [...pane.terminalTabs, { tabId, label: null }],
    activeTerminalTabId: tabId,
    showingFile: false,
  };
  return { ...state, slots: nextSlots };
}

/** Entfernt einen Terminal-Tab aus der Liste einer Pane und beantwortet die
 * Anschlussfrage gleich mit: welcher Tab ist danach aktiv? War der entfernte
 * nicht aktiv, ändert sich daran nichts; war er es, übernimmt sein Vorgänger
 * (an Position 0: sein Nachfolger).
 *
 * Geteilt von `closeTerminalTab` und `moveTerminalTab` — beide entfernen den
 * Tab an derselben Stelle aus derselben Liste und unterscheiden sich nur
 * darin, was DANACH mit ihm passiert (sterben bzw. in einer anderen Pane
 * weiterleben). Aufrufer garantieren `terminalTabs.length > 1` und einen
 * gültigen `tabIndex`; der Fallback-Zugriff unten ist deshalb nie leer. */
function withoutTerminalTab(
  pane: Pane,
  tabIndex: number,
): Pick<Pane, "terminalTabs" | "activeTerminalTabId"> {
  const tabId = (pane.terminalTabs[tabIndex] as TerminalTab).tabId;
  const nextTabs = pane.terminalTabs.filter((tab) => tab.tabId !== tabId);
  const fallbackTab = nextTabs[Math.max(tabIndex - 1, 0)] ?? nextTabs[0];
  return {
    terminalTabs: nextTabs,
    activeTerminalTabId:
      pane.activeTerminalTabId === tabId
        ? (fallbackTab as TerminalTab).tabId
        : pane.activeTerminalTabId,
  };
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

  const nextSlots = state.slots.slice();
  nextSlots[index] = { ...pane, ...withoutTerminalTab(pane, tabIndex) };
  return { ...state, slots: nextSlots };
}

/**
 * Verschiebt einen Terminal-Tab an eine Position einer Pane DESSELBEN
 * Projekts (Ticket 32) — die Ziel-Pane darf seit der Präzisions-Runde
 * (Nutzer-Befund "ich möchte aber auch z. B. im Ziel-Pane das Drag-Tab
 * zwischen zwei andere Tabs platzieren können … auch das Re-Org von Tabs
 * innerhalb eines Panes") auch die QUELLE selbst sein: ein Zug innerhalb
 * derselben Pane ist ein reines Umsortieren, ein Zug in eine andere ein
 * Besitzerwechsel, dessen PTY unverändert weiterläuft (dass das auch beim
 * Rendern hält, ist die eigentliche Arbeit des Tickets, s.
 * `useTerminalTabHosts.ts`). EIN Reducer für beide Fälle, keine zwei — die
 * Geste ist dieselbe, nur die Ziel-Pane unterscheidet sich.
 *
 * `insertIndex` ist der Einfüge-SLOT in der Ziel-Leiste, gezählt VOR dem
 * Herauslösen des Tabs (0 = ganz vorn, `länge` = ganz hinten; ohne Angabe:
 * ganz hinten). Beim Umsortieren innerhalb derselben Pane zählt der Slot also
 * inklusive des gezogenen Tabs selbst — exakt das, was die Leiste beim
 * Schweben anzeigt — und wird intern auf die End-Position umgerechnet.
 *
 * Die Projekt-Gleichheit ist harte Bedingung, nicht Komfort: der `cwd` einer
 * PTY steht beim Spawn fest und ist danach nicht mehr änderbar — ein Tab in
 * einer Pane mit anderem Projektpfad zeigte dauerhaft ein Terminal, das
 * woanders steht als die Pane behauptet (und als der Explorer beim
 * Fokussieren dieser Pane zeigt).
 *
 * Auch der LETZTE Tab einer Pane darf wegziehen (Nutzer-Entscheidung, hebt
 * die frühere Schließen-Untergrenze für diesen Weg auf): die Quelle steht
 * danach ohne Terminal-Tab da — ein Zustand, den `Pane` nicht kennt — und
 * ihr Slot wird deshalb im selben Übergang geleert, mit derselben Nachsorge
 * wie `closePane` (der Fokus wandert ohnehin zur Ziel-Pane, ein etwaiger
 * Fokus-Modus der Quelle endet). Das Aufräumen des Editor-Zustands der
 * verschwundenen Pane liegt beim Aufrufer (`App.tsx`), wie beim Schließen.
 *
 * No-Op (identische Referenz) bei: unbekannter Quell-/Ziel-Pane, unbekanntem
 * Tab, unterschiedlichem Projektpfad, `insertIndex` außerhalb von
 * [0, Ziel-Länge] und einem Umsortieren auf die eigene Position.
 *
 * Der Tab wird am Ziel sofort aktiv (wie `openTerminalTab`), der Fokus
 * wandert zur Ziel-Pane — ohne das zeigten Akzentrahmen und Explorer weiter
 * auf die Quelle, während die Eingabe schon in der Ziel-Pane landet. Das gilt
 * bewusst auch beim Umsortieren innerhalb einer Pane: wer einen Chip greift
 * und ablegt, meint diesen Tab — dieselbe Zuwendung wie beim Zug in eine
 * andere Pane, kein zweites, abweichendes Drop-Verhalten.
 */
export function moveTerminalTab(
  state: GridState,
  sourcePaneId: string,
  tabId: string,
  targetPaneId: string,
  insertIndex?: number,
): GridState {
  const sourceIndex = state.slots.findIndex(
    (slot) => slot?.paneId === sourcePaneId,
  );
  const targetIndex = state.slots.findIndex(
    (slot) => slot?.paneId === targetPaneId,
  );
  if (sourceIndex === -1 || targetIndex === -1) return state;

  const source = state.slots[sourceIndex] as Pane;
  const target = state.slots[targetIndex] as Pane;
  if (source.projectPath !== target.projectPath) return state;

  const tabIndex = source.terminalTabs.findIndex((tab) => tab.tabId === tabId);
  if (tabIndex === -1) return state;
  const movedTab = source.terminalTabs[tabIndex] as TerminalTab;

  const slot = insertIndex ?? target.terminalTabs.length;
  if (slot < 0 || slot > target.terminalTabs.length) return state;

  if (sourcePaneId === targetPaneId) {
    // Umsortieren: Slot (vor dem Herauslösen gezählt) auf die End-Position
    // umrechnen — ein Slot HINTER der eigenen Position rückt um eins auf,
    // sobald der Tab herausgelöst ist.
    const finalIndex = slot > tabIndex ? slot - 1 : slot;
    if (finalIndex === tabIndex) return state;
    const withoutMoved = source.terminalTabs.filter(
      (tab) => tab.tabId !== tabId,
    );
    const nextTabs = [
      ...withoutMoved.slice(0, finalIndex),
      movedTab,
      ...withoutMoved.slice(finalIndex),
    ];
    const nextSlots = state.slots.slice();
    nextSlots[sourceIndex] = {
      ...source,
      terminalTabs: nextTabs,
      activeTerminalTabId: movedTab.tabId,
      showingFile: false,
    };
    return { ...state, slots: nextSlots, focusedPaneId: sourcePaneId };
  }

  const nextSlots = state.slots.slice();
  nextSlots[sourceIndex] =
    source.terminalTabs.length <= 1
      ? null
      : { ...source, ...withoutTerminalTab(source, tabIndex) };
  nextSlots[targetIndex] = {
    ...target,
    terminalTabs: [
      ...target.terminalTabs.slice(0, slot),
      movedTab,
      ...target.terminalTabs.slice(slot),
    ],
    activeTerminalTabId: movedTab.tabId,
    showingFile: false,
  };
  return {
    ...state,
    slots: nextSlots,
    focusedPaneId: targetPaneId,
    maximizedPaneId:
      // Dieselbe Nachsorge wie `closePane`: eine geleerte Quelle kann nicht
      // weiter das ganze Grid einnehmen. Praktisch unerreichbar (im
      // Fokus-Modus ist das Ziehen gesperrt, `PaneGrid.tsx`), aber dieser
      // Reducer setzt keine Aufrufreihenfolge voraus.
      nextSlots[sourceIndex] === null && state.maximizedPaneId === sourcePaneId
        ? null
        : state.maximizedPaneId,
  };
}

/**
 * Verschiebt einen Terminal-Tab auf einen LEEREN Slot — dort entsteht dafür
 * eine neue Pane im Projekt der Quelle, mit genau diesem Tab als einzigem
 * (Nutzer-Wunsch: "wenn ich ein Tab auf einen leeren Slot ziehe, wird dort
 * ein neues Pane erstellt, das dann in dem Projekt des Tabs hängt").
 *
 * Bewusst ein EIGENER Übergang neben `moveTerminalTab` statt eines dritten
 * Zweigs darin: dessen Ziel ist eine existierende `paneId`, hier ist das Ziel
 * eine Slot-POSITION und die Pane entsteht erst — zwei verschiedene
 * Zieltypen in einer Signatur wären eine Falle für jeden Aufrufer. Die
 * Quell-Seite ist dagegen wörtlich dieselbe (inkl. "letzter Tab leert den
 * Slot" — der Zug wird dann praktisch ein Pane-Umzug), deshalb teilt sie
 * `withoutTerminalTab` und die `maximizedPaneId`-Nachsorge.
 *
 * `newPaneId` kommt fertig vom Aufrufer (`useGrid.ts`) — dieses Modul erzeugt
 * keine IDs (Kopfkommentar). No-Op (identische Referenz) bei: unbekannter
 * Quell-Pane, unbekanntem Tab, Index außerhalb des Templates und einem Slot,
 * der gar nicht (mehr) leer ist — Letzteres deckt auch den Wettlauf mit einer
 * parallel laufenden Zuweisung ab, statt eine fremde Pane zu überschreiben.
 *
 * Wie bei `moveTerminalTab`: der Tab ist in der neuen Pane aktiv, der Fokus
 * wandert dorthin.
 */
export function moveTerminalTabToEmptySlot(
  state: GridState,
  sourcePaneId: string,
  tabId: string,
  targetSlotIndex: number,
  newPaneId: string,
): GridState {
  const sourceIndex = state.slots.findIndex(
    (slot) => slot?.paneId === sourcePaneId,
  );
  if (sourceIndex === -1) return state;
  if (targetSlotIndex < 0 || targetSlotIndex >= state.slots.length) return state;
  if (state.slots[targetSlotIndex] !== null) return state;

  const source = state.slots[sourceIndex] as Pane;
  const tabIndex = source.terminalTabs.findIndex((tab) => tab.tabId === tabId);
  if (tabIndex === -1) return state;
  const movedTab = source.terminalTabs[tabIndex] as TerminalTab;

  const nextSlots = state.slots.slice();
  nextSlots[sourceIndex] =
    source.terminalTabs.length <= 1
      ? null
      : { ...source, ...withoutTerminalTab(source, tabIndex) };
  nextSlots[targetSlotIndex] = {
    paneId: newPaneId,
    projectPath: source.projectPath,
    terminalTabs: [movedTab],
    activeTerminalTabId: movedTab.tabId,
    showingFile: false,
  };
  return {
    ...state,
    slots: nextSlots,
    focusedPaneId: newPaneId,
    maximizedPaneId:
      nextSlots[sourceIndex] === null && state.maximizedPaneId === sourcePaneId
        ? null
        : state.maximizedPaneId,
  };
}

/**
 * Zieht eine GANZE Pane in einen leeren Slot (Nutzer-Wunsch: "ich will ein
 * pane auch drag&droppen können von einem auf ein freien slot inkl. aller
 * laufenden pty in dem pane, die dürfen dadurch nicht beeinträchtigt werden
 * — der pane wird nur in einem anderen slot dargestellt").
 *
 * Der entscheidende Unterschied zu `moveTerminalTabToEmptySlot`: hier
 * entsteht NICHTS neu. Die Pane wandert als IDENTISCHES Objekt mitsamt
 * unveränderter `paneId` — die ist der React-Key der Zelle (`PaneGrid.tsx`),
 * eine neue Id würde den gekeyten Teilbaum unmounten und über
 * `usePtyTerminal`s Cleanup jede laufende PTY der Pane killen (exakt die
 * Bug-Klasse aus dem Placement-Vorfall, s. `terminalTabSurfaceOrder`).
 * Slot-Umzug ist damit dieselbe React-Mechanik wie der Slot-Tausch
 * (Ticket 20): die Kinderliste sortiert um, kein Kind verschwindet.
 *
 * `swapPanes` behandelt einen leeren Ziel-Slot bewusst als No-Op (dort wäre
 * "Tausch mit nichts" undefiniert) — deshalb ein eigener Übergang statt
 * einer Lockerung dort. No-Op (identische Referenz) bei: unbekannter Pane,
 * Index außerhalb des Templates und einem nicht (mehr) leeren Ziel-Slot
 * (deckt den Wettlauf mit einer parallelen Zuweisung ab).
 *
 * Der Fokus wandert zur gezogenen Pane — ein Zug ist gerichtet ("DIESE Pane
 * stelle ich dorthin"), anders als der symmetrische Tausch, der den Fokus
 * bewusst nicht anfasst. `maximizedPaneId` bleibt unberührt: die Pane
 * existiert weiter (im Fokus-Modus ist der Zug ohnehin gesperrt,
 * `PaneGrid.tsx`' `dragEnabled`).
 */
export function movePaneToEmptySlot(
  state: GridState,
  paneId: string,
  targetSlotIndex: number,
): GridState {
  const sourceIndex = state.slots.findIndex((slot) => slot?.paneId === paneId);
  if (sourceIndex === -1) return state;
  if (targetSlotIndex < 0 || targetSlotIndex >= state.slots.length) return state;
  if (state.slots[targetSlotIndex] !== null) return state;

  const nextSlots = state.slots.slice();
  nextSlots[targetSlotIndex] = nextSlots[sourceIndex] as Pane;
  nextSlots[sourceIndex] = null;
  return { ...state, slots: nextSlots, focusedPaneId: paneId };
}

/** Setzt/löscht den Anzeigenamen eines Terminal-Tabs (Kontextmenü
 * "Umbenennen", `PaneTabs.tsx`) — reine Chip-Beschriftung, `tabId`/Nummer
 * bleiben unberührt, die Cmd/Strg+1..9-Kürzel bleiben also weiter
 * positionsbasiert gültig (`shortcuts/registry.ts`). `label: null` löscht
 * den Namen wieder, der Chip zeigt dann nur seine Nummer. No-Op bei
 * unbekannter `paneId`/`tabId`. */
export function renameTerminalTab(
  state: GridState,
  paneId: string,
  tabId: string,
  label: string | null,
): GridState {
  const index = state.slots.findIndex((slot) => slot?.paneId === paneId);
  if (index === -1) return state;
  const pane = state.slots[index] as Pane;
  const tabIndex = pane.terminalTabs.findIndex((tab) => tab.tabId === tabId);
  if (tabIndex === -1) return state;

  const nextTabs = pane.terminalTabs.slice();
  nextTabs[tabIndex] = { ...(nextTabs[tabIndex] as TerminalTab), label };

  const nextSlots = state.slots.slice();
  nextSlots[index] = { ...pane, terminalTabs: nextTabs };
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

  // Die geschlossene Pane kann nicht weiter das ganze Grid einnehmen — ohne
  // dieses Aufräumen bliebe `maximizedPaneId` auf eine `paneId` zeigen, die
  // `PaneGrid.tsx` nirgends mehr findet, und das Grid zeigte dauerhaft nichts.
  const nextMaximized =
    state.maximizedPaneId === paneId ? null : state.maximizedPaneId;

  return {
    ...state,
    slots: nextSlots,
    focusedPaneId: nextFocus,
    maximizedPaneId: nextMaximized,
  };
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

/** Versetzt eine Pane in den Fokus-Modus (Ticket 19) — sie nimmt das gesamte
 * Grid ein, die übrigen Panes bleiben mit aktiver PTY im Hintergrund
 * bestehen (`PaneGrid.tsx` entscheidet nur über ihre Sichtbarkeit). Setzt
 * `focusedPaneId` gleich mit, ein Fokus-Modus-Eintritt ist immer auch ein
 * Fokussieren. No-Op bei unbekannter `paneId` oder wenn sie bereits maximiert
 * ist. */
export function enterFocusMode(state: GridState, paneId: string): GridState {
  if (state.maximizedPaneId === paneId) return state;
  if (!state.slots.some((slot) => slot?.paneId === paneId)) return state;
  return { ...state, focusedPaneId: paneId, maximizedPaneId: paneId };
}

/** Verlässt den Fokus-Modus — die übrigen Panes erscheinen unverändert im
 * vorherigen Template-Zustand wieder (er wurde nie verlassen, nur verdeckt).
 * No-Op, wenn kein Fokus-Modus aktiv ist. */
export function exitFocusMode(state: GridState): GridState {
  if (state.maximizedPaneId === null) return state;
  return { ...state, maximizedPaneId: null };
}

/** Wechselt innerhalb des Fokus-Modus direkt zur Pane in `slotIndex` des
 * AKTUELLEN Templates — ohne Zwischenschritt über die Grid-Ansicht (Ticket
 * 19, Zahlen-Hotkeys 1–4). No-Op außerhalb des Fokus-Modus, bei einem leeren
 * Ziel-Slot oder einem Index außerhalb des Templates. */
export function focusModeSelectSlot(
  state: GridState,
  slotIndex: number,
): GridState {
  if (state.maximizedPaneId === null) return state;
  const target = state.slots[slotIndex];
  if (!target) return state;
  return enterFocusMode(state, target.paneId);
}

/** Die nächste (oder vorherige) Pane in Slot-Reihenfolge, umlaufend — die
 * Ordnung hinter den Titelleisten-Pfeilen (`pane-navigation-titlebar/01+02`).
 * Arbeitet auf der bereits belegten, kompaktierten Liste (`activePanes`),
 * anders als `focusModeSelectSlot`, das auf dem rohen `slots`-Array
 * indiziert und bei einem leeren Ziel-Slot no-opt statt zu überspringen — die
 * Pfeile sollen immer auf einer echten Pane landen. `null`, wenn keine Pane
 * belegt ist; bei genau einer Pane liefert beide Richtungen dieselbe (einzige)
 * Pane zurück, die Titelleiste deaktiviert die Pfeile für diesen Fall ohnehin.
 * Eine unbekannte oder fehlende `currentId` (z. B. noch keine Pane fokussiert)
 * startet am Anfang der Liste (next) bzw. am Ende (previous). */
export function nextPaneId(
  panes: readonly Pane[],
  currentId: string | null,
  direction: "next" | "previous",
): string | null {
  if (panes.length === 0) return null;
  const currentIndex = panes.findIndex((pane) => pane.paneId === currentId);
  if (direction === "next") {
    const index = currentIndex === -1 ? 0 : (currentIndex + 1) % panes.length;
    return panes[index]?.paneId ?? null;
  }
  const index =
    currentIndex === -1
      ? panes.length - 1
      : (currentIndex - 1 + panes.length) % panes.length;
  return panes[index]?.paneId ?? null;
}
