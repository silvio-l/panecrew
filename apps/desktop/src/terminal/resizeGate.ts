// Entscheidet, WANN eine vorgeschlagene Terminal-Größenänderung den
// xterm-Puffer tatsächlich reflowen darf — nicht das Resizen selbst
// (`applyResize` übernimmt das). Ausgelagert aus usePtyTerminal.ts, weil sie
// dort nicht für sich testbar wäre: jsdom stubbt ResizeObserver als No-Op und
// liefert für jedes Element offsetWidth/-Height 0 (siehe
// ptyResizeFlush.test.ts), FitAddon.fit() könnte in einem Test also nie einen
// echten Trigger erzeugen. Hier hängt der Zeitgeber (`scheduler`) als
// Parameter, ein Test kann ihn also durch einen manuell steuerbaren Fake
// ersetzen.
//
// Ursache der Korruption, die ptyResizeFlush.test.ts bereits für den
// einzelnen Fall abdeckt: eine Spaltenänderung reflowt den xterm-Puffer
// SOFORT und lokal (terminal.resize() ist synchron), während pty_resize
// (SIGWINCH im Kindprozess, dessen eigener Redraw) asynchron ist — plus,
// backend-seitig, das eigene Batching-Fenster des Rust-Lesethreads
// (OUTPUT_BATCH_MAX_DELAY in pty_manager.rs). Bereits eingetroffene, aber
// noch ungeflushte PTY-Ausgabe fängt der bestehende flushOutput()-vor-fit()-
// Fix ab. Was der DORT bewusst offenlässt: ein Fenster-/Pane-Drag löst nicht
// EINEN ResizeObserver-Tick aus, sondern Dutzende in schneller Folge, jeder
// mit eigenem Reflow UND eigenem pty_resize-Aufruf — jeder davon sein eigenes
// enges Zeitfenster für genau dasselbe Rennen. Das erklärt das gemeldete
// Bild aus mehrfach übereinandergeschriebenem Text bei monoton kleiner
// werdender Breite (mehrere Zwischengrößen einer einzigen Drag-Geste).
//
// Referenz-Fund (VS Codes eigene xterm.js-Integration,
// terminalResizeDebouncer.ts — Muster, nicht Code übernommen, siehe die
// Projektdokumentation zum Referenz-Repo): Zeilenänderungen reflowen nicht
// und bleiben deshalb sofort, Spaltenänderungen werden debounced. Bei kleinem Puffer
// (wenig zu reflowen, wenig zu korrumpieren) entfällt das Debouncing ganz —
// dieselbe Schwelle wie dort (200 Zeilen).
export interface ResizeTarget {
  cols: number;
  rows: number;
}

/** Läuft `run` einmalig nach der Debounce-Verzögerung; die Rückgabe bricht
 * das ab, falls eine neuere Anfrage dazwischenkommt. */
type CancelSchedule = () => void;

export interface ResizeGateScheduler {
  schedule: (run: () => void) => CancelSchedule;
}

export interface ResizeGateOptions {
  /** Liest die TATSÄCHLICHE aktuelle Spaltenzahl — nie gecacht, damit eine
   * noch debouncte (also noch nicht angewendete) Größenänderung weiter
   * gegen die echte Breite VOR dem Resize vergleicht. */
  getCurrentCols: () => number;
  /** Aktuelle Scrollback-Länge des Terminals. */
  bufferLength: () => number;
  debounceThresholdLines?: number;
}

const DEFAULT_DEBOUNCE_THRESHOLD_LINES = 200;

export function createResizeGate(
  applyResize: (target: ResizeTarget) => void,
  scheduler: ResizeGateScheduler,
  options: ResizeGateOptions,
): { request: (target: ResizeTarget) => void; cancel: () => void } {
  const threshold =
    options.debounceThresholdLines ?? DEFAULT_DEBOUNCE_THRESHOLD_LINES;
  let cancelPending: CancelSchedule | null = null;
  let latest: ResizeTarget | null = null;

  const request = (target: ResizeTarget) => {
    latest = target;
    const colsChanged = target.cols !== options.getCurrentCols();

    // Reine Zeilenänderung (oder gar keine Änderung) reflowt xterms Puffer
    // nicht — kein Korruptionsrisiko, also keine Verzögerung wert. Dieselbe
    // Ausnahme bei kleinem Puffer: wenig Zeilen heißt wenig, das falsch
    // reflowen könnte.
    if (!colsChanged || options.bufferLength() < threshold) {
      cancelPending?.();
      cancelPending = null;
      applyResize(target);
      return;
    }

    // Neuere Anfrage ersetzt eine noch laufende — eine Drag-Geste soll genau
    // EINMAL reflowen, am Ende, nicht bei jedem Zwischenschritt.
    cancelPending?.();
    cancelPending = scheduler.schedule(() => {
      cancelPending = null;
      if (latest) applyResize(latest);
    });
  };

  /** Bricht einen noch ausstehenden, debouncten Timer ab, OHNE ihn
   * anzuwenden — für den Unmount-Cleanup: ein Timer, der nach dem Dispose
   * feuert, träfe ein bereits zerstörtes Terminal. */
  const cancel = () => {
    cancelPending?.();
    cancelPending = null;
  };

  return { request, cancel };
}
