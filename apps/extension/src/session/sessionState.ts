// Pure translation between live `GridState` and Rust's `session_store.rs`, at
// the same boundary as `grid/gridState.ts`. It imports neither React nor
// `@tauri-apps`; snake_case field names mirror the Rust schema directly.
//
// v2-Schema (Ticket 17): ein `windows`-Array statt eines einzelnen impliziten
// Fensters, seit Ticket 27 (Multi-Window) tatsächlich mit mehr als einem
// Eintrag befüllt — `label` (Tauri-Fensterlabel, zugleich `PersistedWindow`-
// Schlüssel) ordnet Einträge zu, nicht mehr der Array-Index. `maximized_pane_id`
// (Ticket 19: Fokus-Modus) ist echt verdrahtet, Adapter-Auswahl selbst
// verdrahtet erst ein späteres Ticket (35).
//
// v3-Schema (Ticket 33): jeder Tab (Terminal- wie File-Tab) trägt eine
// stabile `id` — dieselbe `tabId`, die die Live-Panes ohnehin schon führen
// (`gridState.ts`s `TerminalTab.tabId`) —, und `active_tab` referenziert
// darüber statt über Art+Index. Grund: Art+Position identifiziert einen Tab
// nicht mehr eindeutig, sobald sich mehrere File-Tabs und beliebig
// umsortierte Terminal-Tabs unabhängig ändern können (Ticket 34). Rein
// Ticket 34 uses this schema fully: all tab kinds share one order and a pane
// can contain multiple file tabs.

import {
  DEFAULT_TEMPLATE,
  GRID_TEMPLATES,
  activeTab,
  fileTabs,
  terminalTabs,
  type GridState,
  type TemplateId,
} from "../grid/gridState";

// Nicht exportiert, solange nichts außerhalb dieser Datei den Typ selbst
// braucht (nur seine Form, über `PersistedWindow.slots`) — dieselbe
// Konvention wie `gridState.ts`s eigenes, ebenfalls modulinternes `Slot`.
interface PersistedTerminalTab {
  /** Stabile Identität (Ticket 33) — dieselbe `tabId` wie im Live-Zustand
   * (`gridState.ts`s `TerminalTab.tabId`). */
  id: string;
  /** Nutzer-Umbenennung eines Tabs. Nummer/Farbe sind index-abgeleiteter
   * Anzeigezustand (siehe `session_store.rs`), nicht persistiert. */
  title?: string | null;
  /** Gewählter CLI-Tool-Adapter dieses Tabs (Ticket 35) — pro Terminal-Tab,
   * nicht mehr pro Pane, seit eine Pane mehrere unabhängig gestartete
   * Terminal-Tabs haben kann (Ticket 18); dieselbe Verschiebung wie
   * `session_store.rs`s `PersistedTerminalTab.adapter_id`. `null`/fehlend
   * heißt eingebaute Login-Shell. */
  adapter_id?: string | null;
}

interface PersistedFileTab {
  /** Stable live file-tab id used by ordering and active selection. */
  id: string;
  /** Projekt-relativer Pfad — dieselbe Semantik wie das frühere
   * `last_selected_file`, jetzt als eigener optionaler Tab statt als
   * Einzelfeld. */
  path: string;
}

/** Welcher Tab einer Pane aktiv ist, referenziert über die stabile `id`
 * (Ticket 33) statt über Art+Index — Art+Position identifiziert einen Tab
 * nicht mehr eindeutig, sobald Terminal-Tabs und File-Tabs unabhängig
 * voneinander umsortiert/vermehrt werden können (Ticket 34). Der
 * `kind`-Diskriminator bleibt, macht "welche Liste" weiterhin eindeutig. */
type PersistedActiveTab =
  | { kind: "terminal"; id: string }
  | { kind: "file"; id: string };

interface PersistedPane {
  project_path: string;
  terminal_tabs: PersistedTerminalTab[];
  active_tab: PersistedActiveTab;
  /** Round-trip list replacing the former optional singleton. */
  file_tabs?: PersistedFileTab[];
  /** Stable IDs in the pane's kind-crossing display order. Missing values
   * from pre-ticket-34 sessions fall back to terminals followed by files. */
  tab_order?: string[];
}

export interface PersistedWindow {
  /** Natives Tauri-Fensterlabel (`useWindowIdentity.ts`), zugleich der
   * Schlüssel, über den `session_save_window`/`session_remove_window`
   * Einträge zuordnen — nicht mehr der Array-Index. */
  label: string;
  template: string;
  slots: (PersistedPane | null)[];
  /** Grid-Track-Verhältnisse der Schnittkanten dieses Templates, nicht seine
   * Topologie. Leer heißt "Template-Default verwenden". */
  split_ratios?: number[];
  maximized_pane_id?: string | null;
  /** Workspace-folder paths whose pane was deliberately closed by the user
   * (terminal closed, or `closePane` otherwise triggered) while the folder
   * itself stayed part of the multi-root workspace. `slots` alone can't
   * represent this — a closed slot is just `null`, indistinguishable from
   * "this folder was never tracked at all". Without this list, activation's
   * open-folder backfill (`restoreSession.ts`) can't tell "user closed this
   * on purpose" apart from "folder is genuinely new" and re-opens a pane for
   * every open folder on every reload (bug: 2026-08-28). */
  closed_project_paths?: string[];
}

export interface SessionState {
  windows: PersistedWindow[];
  /** AUFgeklappte Ordner je Projektpfad (nicht je Pane/Slot) — dieselbe
   * Schlüsselung wie der Live-Zustand: `ExplorerPanel` hängt an
   * `project.path`, nicht an einer `paneId`, dasselbe Projekt in zwei Panes
   * teilt sich also ohnehin einen Baum. `session_store.rs` überspringt den
   * Schlüssel beim Schreiben, wenn die Map leer ist — hier deshalb optional,
   * nicht als garantiert vorhandenes Feld.
   *
   * Bewusst die aufgeklappten statt der eingeklappten Ordner (2026-08-12):
   * seit „alles eingeklappt" der Default ist, wäre die eingeklappte Menge
   * gleich JEDEM Ordner des Projekts — gemessen 135 KB und ~1900 Pfade bei
   * vier offenen Projekten, und das bei jedem Dateiklick neu geschrieben.
   * Gespeichert wird deshalb die Abweichung vom Default, nicht der Default
   * selbst. */
  expanded_folders?: Record<string, string[]>;
  /** Explorer-Breite in CSS-Pixeln (Ticket 17: die Live-Funktion existiert
   * bereits über `App.tsx`s Resize-Handle, hier kommt nur die Persistenz
   * dazu). */
  explorer_width?: number | null;
  /** Zuletzt geöffnete Projektpfade (Ticket 22), zuletzt geöffnet zuerst —
   * App-weit wie `expanded_folders`/`explorer_width`, nicht je Fenster/Slot.
   * Auf max. `RECENT_PROJECTS_MAX` Einträge gekappt; kein Pinning. */
  recent_projects?: string[];
}

/** Max. Einträge der Recent-Projects-Liste (Ticket 22). */
export const RECENT_PROJECTS_MAX = 8;

/** Rückt `path` an den Anfang der Liste — verschiebt einen bereits
 * vorhandenen Eintrag statt ihn zu duplizieren — und kappt auf
 * `RECENT_PROJECTS_MAX`. */
export function withRecentProject(
  recentProjects: readonly string[],
  path: string,
): string[] {
  return [path, ...recentProjects.filter((existing) => existing !== path)].slice(
    0,
    RECENT_PROJECTS_MAX,
  );
}

/** Entfernt genau `path` aus der Liste ("Aus Liste entfernen") — löscht nur
 * den Listeneintrag, nie das Projekt selbst. No-Op, wenn `path` nicht
 * enthalten ist. */
export function withoutRecentProject(
  recentProjects: readonly string[],
  path: string,
): string[] {
  return recentProjects.filter((existing) => existing !== path);
}

/** Builds one persisted window from the live grid. Explorer globals remain
 * outside this window-specific shape. Terminal metadata and file paths come
 * from their respective tab variants; stable ids drive active selection and
 * `tab_order` preserves their mixed sequence. */
export function buildWindowState(
  label: string,
  grid: GridState,
  closedProjectPaths: readonly string[] = [],
): PersistedWindow {
  return {
    label,
    template: grid.template,
    slots: grid.slots.map((slot): PersistedPane | null => {
      if (slot === null) return null;
      const currentTab = activeTab(slot);
      return {
        project_path: slot.projectPath,
        terminal_tabs: terminalTabs(slot).map((tab) => ({
          id: tab.tabId,
          title: tab.label,
          adapter_id: tab.adapterId,
        })),
        active_tab: { kind: currentTab.kind, id: currentTab.tabId },
        file_tabs: fileTabs(slot).map((tab) => ({ id: tab.tabId, path: tab.path })),
        tab_order: slot.tabs.map((tab) => tab.tabId),
      };
    }),
    split_ratios: [...grid.splitRatios],
    maximized_pane_id: grid.maximizedPaneId,
    closed_project_paths: [...closedProjectPaths],
  };
}

/** Der Sitzungs-Eintrag GENAU dieses Fensters, über sein natives
 * Tauri-Fensterlabel gesucht statt über einen Array-Index (Ticket 27). */
function restoredWindow(
  session: SessionState,
  label: string,
): PersistedWindow | undefined {
  return session.windows.find((window) => window.label === label);
}

/** Das persistierte Template dieses Fensters, validiert gegen die bekannte
 * Liste — eine fremde oder veraltete `session.json` (anderes
 * Template-Vokabular aus einer späteren Version) darf den Start nicht mit
 * einer unbekannten `TemplateId` sprengen, sie fällt auf `DEFAULT_TEMPLATE`
 * zurück statt den Restore ganz abzubrechen — dieselbe "survivable, not
 * fatal"-Haltung wie `session_store.rs`s Ordner-Validierung. Ebenso, wenn
 * dieses Fenster (neu angelegtes Label, oder eine Sitzung von vor Ticket 27)
 * noch gar keinen eigenen Eintrag hat. */
export function restoredTemplate(session: SessionState, label: string): TemplateId {
  const template = restoredWindow(session, label)?.template;
  const known = GRID_TEMPLATES.some((t) => t.id === template);
  return known ? (template as TemplateId) : DEFAULT_TEMPLATE;
}

/** Die Slots dieses Fensters — Restore-Code (`App.tsx`) liest
 * `slot.project_path`, `slot.terminal_tabs` (samt je Tab dessen
 * `adapter_id`, Ticket 35), `slot.active_tab` und `slot.file_tabs`. */
export function restoredSlots(session: SessionState, label: string): (PersistedPane | null)[] {
  return restoredWindow(session, label)?.slots ?? [];
}

/** Die gespeicherten Schnittkanten-Verhältnisse dieses Fensters (Ticket 21) —
 * roh, noch NICHT gegen die Track-Form des (ggf. inzwischen anderen)
 * restaurierten Templates validiert. Das übernimmt der Aufrufer
 * (`App.tsx`) über `grid/splitRatios.ts`s `normalizeRatios`, dieselbe
 * Arbeitsteilung wie bei `restoredTemplate`s Validierung gegen
 * `GRID_TEMPLATES`. */
export function restoredSplitRatios(session: SessionState, label: string): number[] {
  return restoredWindow(session, label)?.split_ratios ?? [];
}

/** Workspace-folder paths the user deliberately closed the pane for while
 * the folder stayed open — see `PersistedWindow.closed_project_paths`. */
export function restoredClosedProjectPaths(session: SessionState, label: string): string[] {
  return restoredWindow(session, label)?.closed_project_paths ?? [];
}
