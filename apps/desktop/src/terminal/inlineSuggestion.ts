import type { IDecoration, IDisposable, IMarker, Terminal } from "@xterm/xterm";
import type { BufferPosition } from "./suggestion";
import { classifyKeystroke, computeGhost, rememberCommand } from "./suggestion";
import type { DirectoryLookup } from "./workingDirectory";

// xterm-Anbindung der Inline-Vervollständigung: hält den Ankerpunkt, liest
// den Bildschirm und malt den Rest des Treffers als gedimmten Geistertext
// hinter den Cursor. Die Entscheidung, WAS angezeigt wird, liegt vollständig
// in suggestion.ts.

export interface InlineSuggestion {
  /** Übernimmt die sichtbare Ergänzung; false, wenn keine sichtbar ist. */
  accept: () => boolean;
  /** Tracking verwerfen — für Eingaben, die nicht durch `onData` laufen. */
  reset: () => void;
  /**
   * Neu rechnen, ohne dass sich am Bildschirm etwas geändert hat — für die
   * Verzeichnisprüfung, deren Antwort erst nach dem Rendern eintrifft.
   */
  refresh: () => void;
  dispose: () => void;
}

export function attachInlineSuggestion(
  terminal: Terminal,
  {
    write,
    baseHistory,
    cwd,
    isDirectory,
    font,
  }: {
    /** Schreibt Text in die PTY (derselbe Pfad wie eine echte Eingabe). */
    write: (text: string) => void;
    /** Datei-History des Nutzers, neueste zuerst; darf leer starten. */
    baseHistory: () => readonly string[];
    /** Aktuelles Arbeitsverzeichnis der Shell, null solange unbekannt. */
    cwd: () => string | null;
    isDirectory: DirectoryLookup;
    font: { fontFamily: string; fontSize: number };
  },
): InlineSuggestion {
  let anchor: BufferPosition | null = null;
  let sessionHistory: string[] = [];
  let ghost = "";
  let marker: IMarker | null = null;
  let decoration: IDecoration | null = null;
  let frame = 0;

  const cursorPosition = (): BufferPosition => {
    const buffer = terminal.buffer.active;
    return { x: buffer.cursorX, y: buffer.baseY + buffer.cursorY };
  };
  const rowText = (y: number) =>
    terminal.buffer.active.getLine(y)?.translateToString(false) ?? "";

  const clearGhost = () => {
    ghost = "";
    decoration?.dispose();
    marker?.dispose();
    decoration = null;
    marker = null;
  };

  const drawGhost = (text: string, x: number) => {
    const nextMarker = terminal.registerMarker(0);
    const nextDecoration = terminal.registerDecoration({
      marker: nextMarker,
      x,
      width: text.length,
      layer: "top",
    });
    if (!nextDecoration) {
      nextMarker.dispose();
      return;
    }
    marker = nextMarker;
    decoration = nextDecoration;
    nextDecoration.onRender((element) => {
      element.textContent = text;
      // Die Zellentypografie steht nicht im Decoration-Container, der Text
      // säße sonst in der UI-Schrift des Chromes über dem Zellraster. Die
      // Zeilenhöhe kommt aus der Box, die xterm dem Element selbst gegeben
      // hat — exakt eine Zellenhöhe, also dieselbe Grundlinie wie die Zeile
      // darunter.
      element.style.fontFamily = font.fontFamily;
      element.style.fontSize = `${font.fontSize}px`;
      element.style.lineHeight = element.style.height || "normal";
      element.style.whiteSpace = "pre";
      element.style.overflow = "visible";
      element.style.pointerEvents = "none";
      // Kein `foregroundColor` in den Decoration-Optionen: das färbt die
      // Zelle und akzeptiert laut Typisierung nur #RRGGBB, könnte ein
      // Theme-Token also gar nicht auflösen.
      element.style.color = "var(--pc-terminal-ghostForeground)";
    });
  };

  const render = () => {
    frame = 0;
    // Immer zuerst und bedingungslos: jeder frühe Ausstieg unterhalb würde
    // sonst Marker in der Buffer-Zeilenliste zurücklassen.
    clearGhost();

    const buffer = terminal.buffer.active;
    const cursor = cursorPosition();
    // Ein Vollbild-Programm hat den Bildschirm getauscht; der Anker zeigte
    // in den alten Puffer und darf nach der Rückkehr nicht wiederaufleben.
    if (buffer.type !== "normal" || anchor?.y !== cursor.y) anchor = null;

    ghost = computeGhost({
      bufferType: buffer.type,
      anchor,
      cursor,
      rowText: anchor ? rowText(anchor.y) : "",
      history: [...sessionHistory, ...baseHistory()],
      cwd: cwd(),
      isDirectory,
    });
    if (ghost) drawGhost(ghost, cursor.x);
  };

  // Ausschließlich ausgabegetrieben: `onData` feuert, BEVOR die PTY das
  // Zeichen zurückgespiegelt hat — dort gerechnet stünde auf dem Schirm
  // immer ein Zeichen weniger, als der Nutzer schon getippt hat.
  const schedule = () => {
    frame ||= requestAnimationFrame(render);
  };

  const disposables: IDisposable[] = [
    terminal.onData((data) => {
      const action = classifyKeystroke(data);
      if (action === "arm") {
        anchor ??= cursorPosition();
        return;
      }
      if (action === "keep") return;
      if (action === "submit" && anchor) {
        // Vor dem Echo des Zeilenumbruchs gelesen — und damit inklusive
        // dessen, was die Shell selbst per Tab-Completion ergänzt hat.
        const command = rowText(anchor.y).slice(anchor.x, cursorPosition().x).trim();
        if (command) sessionHistory = rememberCommand(sessionHistory, command);
      }
      anchor = null;
      clearGhost();
    }),
    terminal.onWriteParsed(schedule),
    terminal.onCursorMove(schedule),
    terminal.onResize(() => {
      // Ein Reflow verschiebt die Eingabe; die Ankerspalte gilt nicht mehr.
      anchor = null;
      schedule();
    }),
  ];

  return {
    accept: () => {
      if (!ghost) return false;
      // Über denselben Schreibpfad wie eine echte Eingabe: die Shell
      // spiegelt den Text zurück, der Geistertext wird dadurch zu Inhalt.
      write(ghost);
      clearGhost();
      return true;
    },
    reset: () => {
      anchor = null;
      clearGhost();
    },
    refresh: schedule,
    dispose: () => {
      if (frame) cancelAnimationFrame(frame);
      for (const disposable of disposables) disposable.dispose();
      clearGhost();
    },
  };
}
