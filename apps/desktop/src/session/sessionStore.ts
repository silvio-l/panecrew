// Dünner IPC-Wrapper um `session_store.rs`, im selben Schnitt wie
// `projects/loadProject.ts`: kein eigener Zustand, keine Logik — nur der
// `invoke`-Aufruf. `saveSession` ist Best-Effort (Ticket 06 fordert kein
// Fehler-Toast, das Auto-Save-Kompfort-Feature darf einen Schreibfehler nicht
// laut machen, den der Nutzer nicht ausgelöst hat); `loadSession` gibt bei
// jedem Fehler `null` zurück, exakt was ein leerer Start (kein `session.json`)
// ohnehin bedeutet.
import { invoke } from "@tauri-apps/api/core";
import type { PersistedWindow, SessionState } from "./sessionState";

export async function loadSession(): Promise<SessionState | null> {
  try {
    return await invoke<SessionState | null>("session_load");
  } catch (error) {
    console.error("PaneCrew: Sitzung konnte nicht geladen werden", error);
    return null;
  }
}

/** Ticket 27: pro Fenster statt als ganzes `windows`-Array — `session_
 * save_window` merged serverseitig anhand `window.label` in die bestehende
 * Datei, statt sie zu überschreiben (`session_store.rs`). `expandedFolders`/
 * `explorerWidth` bleiben window-agnostische Globals, `undefined` lässt sie
 * unangetastet (Rust-seitiges `Option`), ein Wert überschreibt sie. */
export async function saveSessionWindow(
  window: PersistedWindow,
  expandedFolders?: Record<string, string[]>,
  explorerWidth?: number,
): Promise<void> {
  try {
    await invoke("session_save_window", {
      window,
      expandedFolders: expandedFolders ?? null,
      explorerWidth: explorerWidth ?? null,
    });
  } catch (error) {
    console.error("PaneCrew: Sitzung konnte nicht gespeichert werden", error);
  }
}
