import { createContext, useContext } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";

// Der eine Austauschpunkt zwischen `usePtyTerminal.ts` und der tatsächlichen
// PTY-I/O — normalerweise Tauris IPC-Brücke (`tauriPtyBackend`), im
// Demo-Harness (`apps/desktop/src/harness/`) stattdessen ein Fake ohne echten
// Prozess (ADR-0001). Die Produktions-App liefert nie einen Provider, `usePtyTerminal.ts`
// bindet also immer an `tauriPtyBackend` — der Austauschpunkt existiert, ohne
// dass sich am Produktionsverhalten etwas ändert.

interface PtySpawnParams {
  tabId: string;
  cwd: string;
  cols: number;
  rows: number;
  /** Rohe PTY-Ausgabe, ein Aufruf pro Backend-Nachricht. */
  onOutput: (bytes: ArrayBuffer) => void;
}

export interface PtyBackend {
  spawn(params: PtySpawnParams): Promise<void>;
  write(tabId: string, data: Uint8Array): void;
  resize(tabId: string, cols: number, rows: number): void;
  kill(tabId: string): void;
}

function reportIpcFailure(error: unknown): void {
  console.error("PaneCrew: PTY-IPC fehlgeschlagen", error);
}

/** Der IPC-Vertrag (pty_spawn/pty_write/pty_resize/pty_kill) ist eingefroren,
 * siehe `usePtyTerminal.ts`s Kopfkommentar — hier steht nur noch, WIE er
 * gerufen wird, nicht mehr WAS er bedeutet. */
const tauriPtyBackend: PtyBackend = {
  spawn({ tabId, cwd, cols, rows, onOutput }) {
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = onOutput;
    return invoke("pty_spawn", { tabId, cwd, cols, rows, onOutput: channel });
  },
  write(tabId, data) {
    void invoke("pty_write", { tabId, data: Array.from(data) }).catch(
      reportIpcFailure,
    );
  },
  resize(tabId, cols, rows) {
    void invoke("pty_resize", { tabId, cols, rows }).catch(reportIpcFailure);
  },
  kill(tabId) {
    void invoke("pty_kill", { tabId }).catch(reportIpcFailure);
  },
};

export const PtyBackendContext = createContext<PtyBackend>(tauriPtyBackend);

export function usePtyBackend(): PtyBackend {
  return useContext(PtyBackendContext);
}
