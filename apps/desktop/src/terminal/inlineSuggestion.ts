import type { IDecoration, IDisposable, IMarker, Terminal } from "@xterm/xterm";
import type { DirectoryPopupControls } from "./directoryPopup";
import { attachDirectoryPopup } from "./directoryPopup";
import type { SnippetPopupControls } from "./snippetPopup";
import { attachSnippetPopup } from "./snippetPopup";
import type { SnippetCandidate } from "./snippetTrigger";
import type { BufferPosition } from "./suggestion";
import { classifyKeystroke, computeGhost, rememberCommand } from "./suggestion";
import type { DirectoryLookup, SubdirectoryLookup } from "./workingDirectory";

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
  /**
   * Das Verzeichnis-Popup der `cd`-Zeilen.
   *
   * Es hängt hier mit drin, statt eigenständig angebunden zu werden, weil es
   * denselben Ankerpunkt braucht — und den gibt es genau einmal. Ein zweiter
   * Halter desselben Zustands wäre der Anfang genau der Divergenz, die dieses
   * Modul oben zu vermeiden beschreibt.
   */
  directories: DirectoryPopupControls;
  /**
   * The `://` snippet/System-Befehl popup.
   *
   * Owned here for the same reason `directories` is: it needs the same
   * anchor point, and there is exactly one.
   */
  snippets: SnippetPopupControls;
  dispose: () => void;
}

export function attachInlineSuggestion(
  terminal: Terminal,
  {
    write,
    baseHistory,
    cwd,
    isDirectory,
    listSubdirectories,
    listSnippetCandidates,
    runSnippetCommand,
    font,
  }: {
    /** Schreibt Text in die PTY (derselbe Pfad wie eine echte Eingabe). */
    write: (text: string) => void;
    /** Datei-History des Nutzers, neueste zuerst; darf leer starten. */
    baseHistory: () => readonly string[];
    /** Aktuelles Arbeitsverzeichnis der Shell, null solange unbekannt. */
    cwd: () => string | null;
    isDirectory: DirectoryLookup;
    listSubdirectories: SubdirectoryLookup;
    /** System-Befehle + Snippets currently on offer behind the `://` trigger. */
    listSnippetCandidates: () => readonly SnippetCandidate[];
    /** Runs a `"command"`-kind snippet candidate (Ticket 01: only `init`). */
    runSnippetCommand: (trigger: string) => void;
    font: { fontFamily: string; fontSize: number };
  },
): InlineSuggestion {
  let anchor: BufferPosition | null = null;
  let sessionHistory: string[] = [];
  let ghost = "";
  // Die Cursorposition, für die `ghost` berechnet wurde — Pflichtangabe für
  // `accept()`, weil die Neuberechnung erst per `requestAnimationFrame`
  // läuft (s. u.): eine Pfeiltaste nach links bewegt den Bildschirmcursor
  // schon per Shell-Echo, bevor der nächste Frame den Geistertext dafür
  // gelöscht hat. Ohne diesen Abgleich würde ein direkt danach gedrücktes
  // Pfeil-rechts den veralteten Text noch mitten in die Zeile schreiben statt
  // nur den Cursor zu bewegen.
  let ghostCursor: BufferPosition | null = null;
  let marker: IMarker | null = null;
  let decoration: IDecoration | null = null;
  let frame = 0;

  const popup = attachDirectoryPopup(terminal, {
    write,
    listSubdirectories,
    font,
  });
  const snippets = attachSnippetPopup(terminal, {
    write,
    listCandidates: listSnippetCandidates,
    runCommand: runSnippetCommand,
    font,
  });

  const cursorPosition = (): BufferPosition => {
    const buffer = terminal.buffer.active;
    return { x: buffer.cursorX, y: buffer.baseY + buffer.cursorY };
  };
  const rowText = (y: number) =>
    terminal.buffer.active.getLine(y)?.translateToString(false) ?? "";

  const clearGhost = () => {
    ghost = "";
    ghostCursor = null;
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

    const line = {
      bufferType: buffer.type,
      anchor,
      cursor,
      rowText: anchor ? rowText(anchor.y) : "",
      cwd: cwd(),
    };

    ghost = computeGhost({
      ...line,
      history: [...sessionHistory, ...baseHistory()],
      isDirectory,
    });
    ghostCursor = ghost ? cursor : null;
    if (ghost) drawGhost(ghost, cursor.x);

    // Beides zugleich ist Absicht: die Ergänzung im Text ist der eine wahr-
    // scheinliche Befehl aus der History, die Liste darunter alles, was es
    // hier wirklich gibt — dieselbe Aufteilung wie in fish.
    popup.update(line);
    // Structurally exclusive with `popup` above: a word can't simultaneously
    // start with a `cd` argument AND with `://`, so both never show at once
    // in practice — no ordering dependency between the two `update()` calls.
    snippets.update(line);
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
      // Alles, was hier ankommt, hat der Nutzer getippt — eine von uns selbst
      // geschriebene Ergänzung läuft am Terminal vorbei direkt in die PTY.
      // Genau das ist die Grenze, an der ein weggedrücktes Popup wieder gilt.
      popup.resume();
      snippets.resume();
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
      popup.clear();
      snippets.clear();
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
      // Der Cursor kann sich seit der letzten Berechnung schon bewegt haben,
      // ohne dass der nächste Frame das schon nachgezogen hat — dann gehört
      // der Geistertext nicht mehr zur aktuellen Position und wird verworfen
      // statt an der falschen Stelle eingefügt.
      const cursor = cursorPosition();
      if (ghostCursor?.x !== cursor.x || ghostCursor.y !== cursor.y) {
        clearGhost();
        return false;
      }
      // Über denselben Schreibpfad wie eine echte Eingabe: die Shell
      // spiegelt den Text zurück, der Geistertext wird dadurch zu Inhalt.
      write(ghost);
      clearGhost();
      return true;
    },
    reset: () => {
      anchor = null;
      clearGhost();
      popup.clear();
      snippets.clear();
    },
    refresh: schedule,
    directories: {
      visible: popup.visible,
      // Die Auswahl bewegt nur den Index; sichtbar wird sie im nächsten
      // Durchgang, über denselben Pfad wie jede andere Änderung.
      move: (delta) => {
        popup.move(delta);
        schedule();
      },
      accept: () => {
        const accepted = popup.accept();
        if (accepted) schedule();
        return accepted;
      },
      dismiss: () => {
        popup.dismiss();
        schedule();
      },
    },
    snippets: {
      visible: snippets.visible,
      move: (delta) => {
        snippets.move(delta);
        schedule();
      },
      accept: () => {
        const accepted = snippets.accept();
        if (accepted) schedule();
        return accepted;
      },
      dismiss: () => {
        snippets.dismiss();
        schedule();
      },
    },
    dispose: () => {
      if (frame) cancelAnimationFrame(frame);
      for (const disposable of disposables) disposable.dispose();
      clearGhost();
      popup.dispose();
      snippets.dispose();
    },
  };
}
