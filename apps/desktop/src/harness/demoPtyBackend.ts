import type { PtyBackend } from "../terminal/ptyBackend";

export interface DemoPtyBackend extends PtyBackend {
  /** Schreibt `text` als einen Block in die xterm.js-Instanz von `tabId`, als
   * wäre es echte PTY-Ausgabe — kein Zeichen-für-Zeichen-Tippeffekt (Story 9
   * der Spec/ADR-0003: keine kinetische Typografie, auch nicht im
   * Beweisvideo). No-Op, wenn `tabId` (noch) nicht gespawnt oder bereits
   * gekillt wurde. */
  emit(tabId: string, text: string): void;
}

/** Fake-Gegenstück zu `tauriPtyBackend` (`terminal/ptyBackend.ts`) für den
 * Demo-Harness: `spawn` löst sofort auf, ohne `pty_spawn` zu rufen — es gibt
 * nie einen echten Prozess dahinter (ADR-0001). */
export function createDemoPtyBackend(): DemoPtyBackend {
  const outputs = new Map<string, (bytes: ArrayBuffer) => void>();

  return {
    spawn({ tabId, onOutput }) {
      outputs.set(tabId, onOutput);
      return Promise.resolve();
    },
    write() {
      // Demo-Panes sind nicht interaktiv — getippte Eingabe verwirft dieses
      // Backend, statt sie an einen nicht existierenden Prozess zu schicken.
    },
    resize() {
      // Kein echter Prozess, den eine Größenänderung erreichen müsste.
    },
    kill(tabId) {
      outputs.delete(tabId);
    },
    detectTool() {
      // Der Harness hat nie einen echten Prozess dahinter (ADR-0001) — ohne
      // ein Backend-Signal bleibt das Tool-Icon in Promo-Aufnahmen bewusst
      // aus, statt einen erfundenen Treffer vorzutäuschen.
      return Promise.resolve(null);
    },
    emit(tabId, text) {
      const onOutput = outputs.get(tabId);
      if (!onOutput) return;
      onOutput(new TextEncoder().encode(text).buffer);
    },
  };
}
