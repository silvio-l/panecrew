// Reine Entscheidungslogik der Inline-Vervollständigung — bewusst ohne
// xterm.js- und React-Import, gleiche Trennung wie bei ptyIo.ts.
//
// Kernprinzip, und der Grund, warum hier kein mitgeschriebener Tastenpuffer
// steht: der aktuelle Eingabetext wird NICHT aus den Tastendrücken
// rekonstruiert, sondern aus dem echten Bildschirminhalt gelesen. Ein
// gespiegelter Puffer läuft auseinander, sobald die Shell selbst die Zeile
// umschreibt (Tab-Completion, Ctrl+R, History mit Pfeil hoch) — genau der
// Rekonstruktions-Ansatz, den dieses Projekt an anderer Stelle schon
// verworfen hat. Mitgeführt wird deshalb nur EIN Datum, das man vom
// Bildschirm nicht ablesen kann: die Spalte, an der der Prompt endet und die
// Eingabe beginnt (der Anker). Alles andere ist gelesener Zustand.

/** Position im absoluten Buffer-Koordinatensystem (`baseY + cursorY`). */
export interface BufferPosition {
  x: number;
  y: number;
}

/** Was ein Tastendruck mit dem Anker macht. */
export type AnchorAction =
  /** Zeile abgeschickt: Eingabe merken, Anker fallenlassen. */
  | "submit"
  /** Zeile verworfen (Ctrl+C/Ctrl+D): Anker fallenlassen. */
  | "abort"
  /** Anker setzen, falls noch keiner steht. */
  | "arm"
  /** Anker unverändert lassen. */
  | "keep";

/**
 * Ein Tastendruck (bzw. eingefügter Text) aus `terminal.onData`.
 *
 * Nur diese vier Klassen sind nötig, weil der Eingabetext ohnehin vom
 * Bildschirm kommt: Backspace, Ctrl+U, Ctrl+W und die Tab-Completion der
 * Shell fallen unter "keep" und werden automatisch korrekt, sobald ihr
 * Ergebnis auf dem Schirm steht.
 */
export function classifyKeystroke(data: string): AnchorAction {
  if (data.includes("\r") || data.includes("\n")) return "submit";
  // Ctrl+C verwirft die Zeile, Ctrl+D beendet die Shell — in beiden Fällen
  // gilt der bisherige Ankerpunkt nicht weiter.
  if (data === "\x03" || data === "\x04") return "abort";
  if (data.startsWith("\x1b") || hasPrintable(data)) return "arm";
  return "keep";
}

function hasPrintable(data: string): boolean {
  for (const char of data) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) return true;
  }
  return false;
}

export interface GhostInput {
  /** `terminal.buffer.active.type` — das Alternate-Screen-Gate. */
  bufferType: "normal" | "alternate";
  anchor: BufferPosition | null;
  cursor: BufferPosition;
  /** Volltext der Ankerzeile, ungetrimmt (also inklusive Leerzellen). */
  rowText: string;
  /** Kandidaten, neueste zuerst. */
  history: readonly string[];
}

/**
 * Der sichtbare Rest des besten History-Treffers — oder "" für "nichts
 * anzeigen".
 *
 * Das Alternate-Screen-Gate steht bewusst hier und nicht nur im Aufrufer:
 * Vollbild-Programme (vim, jedes Ink-basierte CLI-Tool wie Claude Code)
 * malen ihre eigene Eingabezeile über dieselbe Bildschirmfläche. Eine
 * Ergänzung dort wäre nicht nur nutzlos, sondern läge sichtbar im fremden
 * Layout.
 *
 * Zwei weitere Bedingungen halten die Anzeige ehrlich, ohne zu raten:
 * - Cursor und Anker müssen auf derselben Zeile liegen. Sonst hat entweder
 *   ein Zeilenumbruch oder fremde Ausgabe die Eingabe verschoben, und die
 *   Ankerspalte zeigt ins Leere.
 * - Die Ergänzung wird auf die tatsächlich freien Zellen hinter dem Cursor
 *   gekürzt. Das schützt ein rechtsbündiges Prompt (zsh RPROMPT) oder eine
 *   bereits vorhandene Vervollständigung eines Shell-Plugins davor,
 *   überschrieben zu werden, und begrenzt die Ausgabe zugleich auf die
 *   Zeilenbreite.
 */
export function computeGhost({
  bufferType,
  anchor,
  cursor,
  rowText,
  history,
}: GhostInput): string {
  if (bufferType !== "normal") return "";
  if (anchor?.y !== cursor.y || cursor.x <= anchor.x) return "";

  const input = rowText.slice(anchor.x, cursor.x);
  if (!input.trim()) return "";

  // Mehrzeilige History-Einträge werden übersprungen statt gekürzt: ihr
  // sichtbarer Rest wäre ein Befehl, den anzunehmen etwas anderes ausführt
  // als angezeigt.
  const match = history.find(
    (entry) =>
      entry.length > input.length &&
      entry.startsWith(input) &&
      !entry.includes("\n"),
  );
  if (!match) return "";

  return match.slice(input.length, input.length + blankRunAfter(rowText, cursor.x));
}

function blankRunAfter(rowText: string, x: number): number {
  let run = 0;
  while (rowText[x + run] === " ") run += 1;
  return run;
}

/**
 * In dieser Pane bereits ausgeführte Befehle, neueste zuerst.
 *
 * Das ist der Kontext, den es hier wirklich gibt: Shell-History-Dateien
 * speichern kein Arbeitsverzeichnis (weder zsh noch bash), eine Sortierung
 * "erst was in diesem Projekt lief" ist daraus also nicht ableitbar. Was
 * eine Pane dagegen sicher weiß, ist, was in ihr selbst — und damit in genau
 * diesem Projektverzeichnis — getippt wurde. Diese Liste läuft deshalb im
 * Ranking vor der Datei-History.
 */
export function rememberCommand(
  history: readonly string[],
  command: string,
  limit = 200,
): string[] {
  return [command, ...history.filter((entry) => entry !== command)].slice(
    0,
    limit,
  );
}
