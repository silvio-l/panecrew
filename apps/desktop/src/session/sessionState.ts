// Reine Übersetzung zwischen dem Live-App-Zustand (`GridState` +
// `selectedFile`) und der Rust-Seite (`session_store.rs`), im selben Schnitt
// wie `grid/gridState.ts`: kein React-, kein `@tauri-apps`-Import. Feldnamen
// bleiben `snake_case` — `session_store.rs` hat kein `serde(rename_all)`,
// dieselbe Konvention wie `FileStamp.modified_ms`.
//
// v2-Schema (Ticket 17): ein `windows`-Array statt eines einzelnen impliziten
// Fensters, seit Ticket 27 (Multi-Window) tatsächlich mit mehr als einem
// Eintrag befüllt — `label` (Tauri-Fensterlabel, zugleich `PersistedWindow`-
// Schlüssel) ordnet Einträge zu, nicht mehr der Array-Index. Diese Datei
// liefert/liest die neuen Terminal-Tab-, Aktiver-Tab- und Adapter-Felder nur
// als Rundlauf-Daten (Default-Werte, kein Datenverlust bei Restart) — mehrere
// Terminal-Tabs und Adapter-Auswahl selbst verdrahtet erst ein späteres
// Ticket. `maximized_pane_id` (Ticket 19: Fokus-Modus) ist dagegen bereits
// echt verdrahtet.

import { DEFAULT_TEMPLATE, GRID_TEMPLATES, type GridState, type TemplateId } from "../grid/gridState";

// Nicht exportiert, solange nichts außerhalb dieser Datei den Typ selbst
// braucht (nur seine Form, über `PersistedWindow.slots`) — dieselbe
// Konvention wie `gridState.ts`s eigenes, ebenfalls modulinternes `Slot`.
interface PersistedTerminalTab {
  /** Nutzer-Umbenennung eines Tabs. Nummer/Farbe sind index-abgeleiteter
   * Anzeigezustand (siehe `session_store.rs`), nicht persistiert. */
  title?: string | null;
}

interface PersistedFileTab {
  /** Projekt-relativer Pfad — dieselbe Semantik wie das frühere
   * `last_selected_file`, jetzt als eigener optionaler Tab statt als
   * Einzelfeld. */
  path: string;
}

/** Welcher Tab einer Pane aktiv ist. Ein reiner Index wäre mehrdeutig,
 * sobald sich Terminal-Tab-Array und File-Tab unabhängig ändern — der
 * `kind`-Diskriminator macht "welcher Tab" eindeutig. */
type PersistedActiveTab = { kind: "terminal"; index: number } | { kind: "file" };

interface PersistedPane {
  project_path: string;
  terminal_tabs: PersistedTerminalTab[];
  active_tab: PersistedActiveTab;
  file_tab?: PersistedFileTab | null;
  /** Gewählter CLI-Tool-Adapter (Ticket 12s Adapter-Manifest); `null`/fehlend
   * heißt nackte Shell. */
  adapter_id?: string | null;
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

/** Baut den zu persistierenden Zustand EINES Fensters (Ticket 27) aus dem
 * laufenden Grid und der `paneId`-geschlüsselten Dateiauswahl im Explorer
 * (Ticket 06) — `expanded_folders`/`explorer_width` gehören nicht hierher,
 * die bleiben window-agnostische Globals und gehen separat an
 * `saveSessionWindow` (`session_store.rs`s eigener Kommentar). Jede Pane
 * trägt seit Ticket 18 ihre echten Terminal-Tabs (`Pane.terminalTabs`) ein,
 * `title` ist seit dem Kontextmenü-Umbenennen (`PaneTabs.tsx`)
 * `Pane.terminalTabs[i].label`. Aktiver Tab ist `Pane.activeTerminalTabId`,
 * als Index in `terminal_tabs` (das persistierte Schema kennt keine `tabId`,
 * s. `PersistedActiveTab`), AUSSER eine Datei ist sowohl ausgewählt als auch
 * als aktive Ansicht gewählt — genau dieselbe "nur wenn wirklich offen"-
 * Bedingung wie `PaneGrid.tsx`s `showingFile`, hier unabhängig nachgebildet:
 * dieses Modul kennt keinen Editor-Zustand, nur die `selectedFile`-Map, die
 * exakt genau dann einen Eintrag für eine Pane trägt, wenn deren Datei
 * tatsächlich offen ist. `maximized_pane_id` (Ticket 19) kommt direkt aus
 * `grid.maximizedPaneId` — echt verdrahtet für den Save, das Zurückmappen
 * auf eine frisch erzeugte `paneId` beim Restore bleibt offen (Ticket 19,
 * Persistenz-Teilaufgabe). */
export function buildWindowState(
  label: string,
  grid: GridState,
  selectedFile: Record<string, string>,
): PersistedWindow {
  return {
    label,
    template: grid.template,
    slots: grid.slots.map((slot): PersistedPane | null => {
      if (slot === null) return null;
      const lastSelectedFile = selectedFile[slot.paneId] ?? null;
      const showingFile = slot.showingFile && lastSelectedFile !== null;
      const activeTabIndex = slot.terminalTabs.findIndex(
        (tab) => tab.tabId === slot.activeTerminalTabId,
      );
      return {
        project_path: slot.projectPath,
        terminal_tabs: slot.terminalTabs.map((tab) => ({ title: tab.label })),
        active_tab: showingFile
          ? { kind: "file" }
          : { kind: "terminal", index: Math.max(activeTabIndex, 0) },
        file_tab: lastSelectedFile === null ? null : { path: lastSelectedFile },
        adapter_id: null,
      };
    }),
    split_ratios: [],
    maximized_pane_id: grid.maximizedPaneId,
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

/** Die Slots dieses Fensters — Restore-Code fragt nach `slot.project_path`/
 * `slot.file_tab`, nicht nach den neuen, noch
 * unverdrahteten Feldern (Terminal-Tab-Array, `adapter_id`, …). */
export function restoredSlots(session: SessionState, label: string): (PersistedPane | null)[] {
  return restoredWindow(session, label)?.slots ?? [];
}
