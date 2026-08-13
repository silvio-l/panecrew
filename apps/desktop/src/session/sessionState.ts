// Reine Übersetzung zwischen dem Live-App-Zustand (`GridState` +
// `selectedFile`) und der Rust-Seite (`session_store.rs`), im selben Schnitt
// wie `grid/gridState.ts`: kein React-, kein `@tauri-apps`-Import. Feldnamen
// bleiben `snake_case` — `session_store.rs` hat kein `serde(rename_all)`,
// dieselbe Konvention wie `FileStamp.modified_ms`.
//
// v2-Schema (Ticket 17): ein `windows`-Array statt eines einzelnen impliziten
// Fensters. Solange Multi-Window (Spec-Batch 2026-08-12) noch nicht gebaut
// ist, hält die App genau ein Fenster in diesem Array — `buildSessionState`/
// `restoredTemplate` unten greifen deshalb fest auf `windows[0]` zu. Ebenso
// liefert/liest diese Datei die neuen Terminal-Tab-, Aktiver-Tab-, Adapter-,
// Maximiert- und Schnittkanten-Ratio-Felder nur als Rundlauf-Daten (Default-
// Werte, kein Datenverlust bei Restart) — die Features selbst (mehrere
// Terminal-Tabs, Fokus-Modus, Splitter, Adapter-Auswahl) verdrahtet erst
// Ticket 18 ff.

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

interface PersistedWindow {
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
}

/** Baut den zu persistierenden Zustand aus dem laufenden Grid, der
 * `paneId`-geschlüsselten Dateiauswahl im Explorer (Ticket 06), dem
 * projektpfad-geschlüsselten Aufklapp-Zustand des Baums und der
 * Explorer-Breite. Jede Pane trägt seit Ticket 18 ihre echten Terminal-Tabs
 * (`Pane.terminalTabs`) ein — nur `title` bleibt vorerst immer leer, ein
 * Umbenennen von Tabs ist nicht Teil dieses Tickets. Aktiver Tab ist
 * `Pane.activeTerminalTabId`, als Index in `terminal_tabs` (das persistierte
 * Schema kennt keine `tabId`, s. `PersistedActiveTab`), AUSSER eine Datei ist
 * sowohl ausgewählt als auch als aktive Ansicht gewählt — genau dieselbe
 * "nur wenn wirklich offen"-Bedingung wie `PaneGrid.tsx`s `showingFile`, hier
 * unabhängig nachgebildet: dieses Modul kennt keinen Editor-Zustand, nur die
 * `selectedFile`-Map, die exakt genau dann einen Eintrag für eine Pane trägt,
 * wenn deren Datei tatsächlich offen ist. Solange es nur ein Fenster gibt,
 * landet der gesamte Grid-Zustand in `windows[0]`. */
export function buildSessionState(
  grid: GridState,
  selectedFile: Record<string, string>,
  expandedFolders: Record<string, string[]>,
  explorerWidth: number,
): SessionState {
  return {
    windows: [
      {
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
            terminal_tabs: slot.terminalTabs.map(() => ({})),
            active_tab: showingFile
              ? { kind: "file" }
              : { kind: "terminal", index: Math.max(activeTabIndex, 0) },
            file_tab: lastSelectedFile === null ? null : { path: lastSelectedFile },
            adapter_id: null,
          };
        }),
        split_ratios: [],
        maximized_pane_id: null,
      },
    ],
    expanded_folders: expandedFolders,
    explorer_width: explorerWidth,
  };
}

/** Das persistierte Template des ersten (bislang einzigen) Fensters,
 * validiert gegen die bekannte Liste — eine fremde oder veraltete
 * `session.json` (anderes Template-Vokabular aus einer späteren Version)
 * darf den Start nicht mit einer unbekannten `TemplateId` sprengen, sie
 * fällt auf `DEFAULT_TEMPLATE` zurück statt den Restore ganz abzubrechen —
 * dieselbe "survivable, not fatal"-Haltung wie `session_store.rs`s
 * Ordner-Validierung. */
export function restoredTemplate(session: SessionState): TemplateId {
  const template = session.windows[0]?.template;
  const known = GRID_TEMPLATES.some((t) => t.id === template);
  return known ? (template as TemplateId) : DEFAULT_TEMPLATE;
}

/** Die Slots des ersten (bislang einzigen) Fensters — Restore-Code fragt
 * nach `slot.project_path`/`slot.file_tab`, nicht nach den neuen, noch
 * unverdrahteten Feldern (Terminal-Tab-Array, `adapter_id`, …). */
export function restoredSlots(session: SessionState): (PersistedPane | null)[] {
  return session.windows[0]?.slots ?? [];
}
