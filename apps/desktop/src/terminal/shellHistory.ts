import { invoke } from "@tauri-apps/api/core";

/**
 * Die History-Datei der Login-Shell, neueste Einträge zuerst.
 *
 * Genau einmal pro App-Lauf gelesen, nicht einmal pro Pane: bei vier Panes
 * wäre das viermal dieselbe Datei. Ein Fehlschlag ist kein Fehlerfall,
 * sondern der normale Zustand für Shells ohne lesbare History — die Panes
 * schlagen dann nur aus ihrer eigenen Sitzung vor.
 */
let pending: Promise<readonly string[]> | null = null;

export function loadShellHistory(): Promise<readonly string[]> {
  pending ??= invoke<string[]>("shell_history_read").catch(() => []);
  return pending;
}
