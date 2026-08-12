// Reine Übersetzung zwischen dem Live-App-Zustand (`GridState` +
// `selectedFile`) und der Rust-Seite (`session_store.rs`), im selben Schnitt
// wie `grid/gridState.ts`: kein React-, kein `@tauri-apps`-Import. Feldnamen
// bleiben `snake_case` — `session_store.rs` hat kein `serde(rename_all)`,
// dieselbe Konvention wie `FileStamp.modified_ms`.

import { DEFAULT_TEMPLATE, GRID_TEMPLATES, type GridState, type TemplateId } from "../grid/gridState";

// Nicht exportiert, solange nichts außerhalb dieser Datei den Typ selbst
// braucht (nur seine Form, über `SessionState.slots`) — dieselbe Konvention
// wie `gridState.ts`s eigenes, ebenfalls modulinternes `Slot`.
interface PersistedSlot {
  project_path: string;
  last_selected_file: string | null;
}

export interface SessionState {
  template: string;
  slots: (PersistedSlot | null)[];
  /** Eingeklappte Ordner je Projektpfad (nicht je Pane/Slot) — dieselbe
   * Schlüsselung wie der Live-Zustand: `ExplorerPanel` hängt an
   * `project.path`, nicht an einer `paneId`, dasselbe Projekt in zwei Panes
   * teilt sich also ohnehin einen Baum. `session_store.rs` überspringt den
   * Schlüssel beim Schreiben, wenn die Map leer ist — hier deshalb optional,
   * nicht als garantiert vorhandenes Feld. */
  collapsed_folders?: Record<string, string[]>;
}

/** Baut den zu persistierenden Zustand aus dem laufenden Grid, der
 * `paneId`-geschlüsselten Dateiauswahl im Explorer (Ticket 06) und dem
 * projektpfad-geschlüsselten Einklapp-Zustand des Baums. Eine Pane ohne
 * offene Datei liefert `last_selected_file: null`, nicht ein fehlendes
 * Feld — auf beides antwortet `session_store.rs`s `Option<String>` gleich,
 * `null` ist hier einfach das explizitere JSON. */
export function buildSessionState(
  grid: GridState,
  selectedFile: Record<string, string>,
  collapsedFolders: Record<string, string[]>,
): SessionState {
  return {
    template: grid.template,
    slots: grid.slots.map((slot) =>
      slot === null
        ? null
        : {
            project_path: slot.projectPath,
            last_selected_file: selectedFile[slot.paneId] ?? null,
          },
    ),
    collapsed_folders: collapsedFolders,
  };
}

/** Das persistierte Template, validiert gegen die bekannte Liste — eine
 * fremde oder veraltete `session.json` (anderes Template-Vokabular aus einer
 * späteren Version) darf den Start nicht mit einer unbekannten `TemplateId`
 * sprengen, sie fällt auf `DEFAULT_TEMPLATE` zurück statt den Restore ganz
 * abzubrechen — dieselbe "survivable, not fatal"-Haltung wie
 * `session_store.rs`s Ordner-Validierung. */
export function restoredTemplate(session: SessionState): TemplateId {
  const known = GRID_TEMPLATES.some((t) => t.id === session.template);
  return known ? (session.template as TemplateId) : DEFAULT_TEMPLATE;
}
