// Ticket 27 (Multi-Window): welchen `PersistedWindow`-Eintrag dieses Fenster
// besitzt und ob es das Hauptfenster ist. `windows.rs::window_open_new`
// generiert Tauri-Fensterlabel und `?window=`-Query-Param aus demselben
// String — das native Fensterlabel ist also bereits die volle Identität,
// ein zusätzliches Parsen der Query trägt nichts bei. Reine Funktion statt
// State/Effect: das Label eines Fensters ändert sich nie über dessen
// Lebenszeit, es gibt nichts zu re-rendern.
import { getCurrentWindow } from "@tauri-apps/api/window";

const MAIN_WINDOW_LABEL = "main";

export interface WindowIdentity {
  /** Natives Tauri-Fensterlabel, zugleich der `PersistedWindow.label`, unter
   * dem dieses Fenster seinen Sitzungs-Eintrag sichert/lädt. */
  label: string;
  /** Nur das Hauptfenster empfängt Splash-Reveal (`main_ready`) und den
   * CLI-Startpfad (`get_launch_project`) — beide Rust-Commands gaten bereits
   * serverseitig darauf, dieses Flag spart einem zweiten Fenster nur den
   * nutzlosen IPC-Aufruf. */
  isMain: boolean;
}

export function windowIdentity(): WindowIdentity {
  const label = getCurrentWindow().label;
  return { label, isMain: label === MAIN_WINDOW_LABEL };
}
