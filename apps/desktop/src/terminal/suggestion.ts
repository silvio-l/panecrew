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

import type { DirectoryLookup } from "./workingDirectory";

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
  /**
   * Wo die Shell dieser Pane gerade steht, oder null, solange sie es nicht
   * gemeldet hat. Nicht das Startverzeichnis der Pane: der Nutzer ist seither
   * womöglich woanders hin gewechselt.
   */
  cwd: string | null;
  isDirectory: DirectoryLookup;
}

/**
 * Wie viele passende History-Einträge höchstens betrachtet werden.
 *
 * Ohne Grenze könnte eine History mit hundert `cd`-Zeilen bei der Eingabe
 * `cd ` hundert Verzeichnisprüfungen auslösen — für einen Vorschlag, von dem
 * ohnehin nur der erste bestätigte Treffer zählt.
 */
const MAX_CANDIDATES = 12;

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
 *
 * Ein `cd`-Kandidat muss zusätzlich gegen das echte Dateisystem bestätigt
 * sein — siehe `cdTarget`.
 */
export function computeGhost({
  bufferType,
  anchor,
  cursor,
  rowText,
  history,
  cwd,
  isDirectory,
}: GhostInput): string {
  if (bufferType !== "normal") return "";
  if (anchor?.y !== cursor.y || cursor.x <= anchor.x) return "";

  const input = rowText.slice(anchor.x, cursor.x);
  if (!input.trim()) return "";

  let unconfirmed = false;
  let considered = 0;

  for (const entry of history) {
    if (considered >= MAX_CANDIDATES) break;
    // Mehrzeilige History-Einträge werden übersprungen statt gekürzt: ihr
    // sichtbarer Rest wäre ein Befehl, den anzunehmen etwas anderes ausführt
    // als angezeigt.
    if (
      entry.length <= input.length ||
      !entry.startsWith(input) ||
      entry.includes("\n")
    ) {
      continue;
    }
    considered += 1;

    const target = cdTarget(entry);
    if (target !== null) {
      // Ohne bekanntes Arbeitsverzeichnis gibt es nichts, wogegen man prüfen
      // könnte — dann lieber gar kein `cd`-Vorschlag als ein geratener.
      if (!cwd) continue;
      const exists = isDirectory(cwd, target);
      if (exists === undefined) {
        // Die Prüfung läuft noch. Weitersuchen, damit die übrigen Kandidaten
        // im selben Durchgang mitangestoßen werden statt einer nach dem
        // anderen.
        unconfirmed = true;
        continue;
      }
      if (!exists) continue;
    }

    // Ein bestätigter Treffer — aber ein noch ungeprüfter Kandidat davor wäre
    // der bessere. Einen Frame lang nichts zu zeigen ist besser, als kurz das
    // Falsche zu zeigen und es dann auszutauschen.
    if (unconfirmed) return "";
    return entry.slice(
      input.length,
      input.length + blankRunAfter(rowText, cursor.x),
    );
  }

  return "";
}

/**
 * Das Zielverzeichnis eines `cd`-Befehls, oder null für alles andere.
 *
 * Der Grund, warum es diese Prüfung überhaupt gibt: Shell-History-Dateien
 * speichern kein Arbeitsverzeichnis. Ein irgendwann einmal getipptes
 * `cd Desktop` wurde deshalb auch in einem Projekt vorgeschlagen, das gar kein
 * `Desktop` enthält — angenommen ergab das ein „no such file or directory".
 *
 * Bewusst nur `cd` und bewusst keine Shell-Grammatik: gelesen wird das erste
 * Wort hinter `cd`, in Anführungszeichen auch mit Leerzeichen. Alles, was
 * daraus kein prüfbarer Pfad wird (`cd -`, `cd $PROJECT`, ein Glob), liefert
 * hier einen Kandidaten, den das Dateisystem nicht bestätigt — der Vorschlag
 * entfällt dann. Das ist die sichere Richtung: ein Vorschlag zu wenig statt
 * einer, der ins Leere führt.
 *
 * `cd` ohne Argument (das Home-Verzeichnis) hat kein Ziel zu prüfen und gilt
 * wie jeder andere Befehl.
 */
function cdTarget(command: string): string | null {
  const rest = /^cd\s+(.*)$/.exec(command)?.[1]?.trim();
  if (!rest) return null;
  const token = /^"([^"]*)"|^'([^']*)'|^(\S+)/.exec(rest);
  return token?.[1] ?? token?.[2] ?? token?.[3] ?? null;
}

/** Der gerade getippte Pfad eines `cd`-Befehls, aufgeteilt zum Nachschlagen. */
export interface CdCompletion {
  /** Arbeitsverzeichnis der Pane — hier bereits als bekannt bestätigt. */
  cwd: string;
  /** Getippter Pfad bis einschließlich des letzten `/`; "" heißt „im cwd". */
  directory: string;
  /** Das angefangene letzte Segment; "" direkt nach `cd `. */
  prefix: string;
  /** Steht das Argument in einem noch offenen Anführungszeichen? */
  quoted: boolean;
}

export interface CdCompletionInput {
  bufferType: "normal" | "alternate";
  anchor: BufferPosition | null;
  cursor: BufferPosition;
  rowText: string;
  /** Arbeitsverzeichnis der Pane, null solange unbekannt. */
  cwd: string | null;
}

/**
 * Was das Verzeichnis-Popup zeigen müsste — oder null für „nicht jetzt".
 *
 * Der Unterschied zur Geistertext-Vervollständigung darüber: die rät aus der
 * History und lässt sich das Geratene bestätigen; das hier fragt gar nicht
 * erst, sondern liest, was im Arbeitsverzeichnis wirklich liegt. Diese
 * Funktion entscheidet nur, wonach zu fragen ist.
 *
 * Vier Bedingungen, die alle aus dem Zeigen ein Raten machen würden:
 * - Alternate Screen: ein Vollbild-Programm besitzt den Bildschirm.
 * - Kein Anker oder Cursor in einer anderen Zeile: die Ankerspalte, ab der die
 *   Eingabe gelesen wird, zeigt dann ins Leere.
 * - Kein bekanntes Arbeitsverzeichnis: ohne das gibt es kein Verzeichnis, das
 *   man auflisten könnte. Das deckt zugleich den ssh-Fall ab — meldet in der
 *   Pane ein anderer Rechner, setzt der Aufrufer den Wert auf null zurück.
 * - Direkt hinter dem Cursor steht Text: der Nutzer bearbeitet die Mitte
 *   seiner Zeile, eine übernommene Ergänzung landete mitten im Rest.
 */
export function cdCompletion({
  bufferType,
  anchor,
  cursor,
  rowText,
  cwd,
}: CdCompletionInput): CdCompletion | null {
  if (bufferType !== "normal" || !cwd) return null;
  if (anchor?.y !== cursor.y || cursor.x <= anchor.x) return null;
  if (cursor.x < rowText.length && rowText[cursor.x] !== " ") return null;

  const argument = cdArgument(rowText.slice(anchor.x, cursor.x));
  if (!argument) return null;

  // Getrennt wird am letzten `/`: alles davor benennt das aufzulistende
  // Verzeichnis, alles danach ist das Präfix, gegen das gefiltert wird.
  // Aufgelöst (`~`, relativ, absolut) wird der vordere Teil erst im Backend.
  const cut = argument.text.lastIndexOf("/");
  return {
    cwd,
    directory: argument.text.slice(0, cut + 1),
    prefix: argument.text.slice(cut + 1),
    quoted: argument.quoted,
  };
}

/**
 * Das angefangene Pfad-Argument einer `cd`-Zeile.
 *
 * Bewusst nicht mit `cdTarget` zusammengelegt, obwohl beide `cd` lesen: dort
 * geht es um ein FERTIGES Ziel aus der History (Anführungszeichen geschlossen,
 * dahinter darf noch ein `&& …` folgen), hier um ein Argument, das noch
 * getippt wird — ein offenes Anführungszeichen ist der Normalfall, und ein
 * Leerzeichen dahinter heißt, dass der Pfad bereits fertig ist und gerade
 * etwas anderes entsteht.
 */
function cdArgument(input: string): { text: string; quoted: boolean } | null {
  const rest = /^\s*cd\s+(.*)$/.exec(input)?.[1];
  if (rest === undefined) return null;

  const quote = /^["']/.exec(rest)?.[0];
  if (quote) {
    const text = rest.slice(1);
    return text.includes(quote) ? null : { text, quoted: true };
  }
  return /\s/.test(rest) ? null : { text: rest, quoted: false };
}

/**
 * Was in die PTY geschrieben wird, wenn ein Eintrag übernommen wird.
 *
 * Der abschließende `/` steht bewusst da: er ist für `cd` bedeutungslos, macht
 * den Eintrag aber sofort zum Ausgangspunkt der nächsten Ebene, ohne dass ein
 * Zeichen nachgetippt werden muss.
 *
 * Gefiltert wird ohne Rücksicht auf Groß-/Kleinschreibung (`cd sr` erreicht
 * auch `Src`, so wie `cd` selbst auf diesen Dateisystemen). Dann ist das
 * Getippte aber nicht immer ein Präfix des echten Namens — in dem Fall wird es
 * per Backspace zurückgenommen und der Name vollständig geschrieben, statt ein
 * `srCase` aus zwei Schreibweisen entstehen zu lassen.
 */
export function completionInsert(
  prefix: string,
  name: string,
  quoted: boolean,
): string {
  const insert = name.startsWith(prefix)
    ? `${name.slice(prefix.length)}/`
    : `${"\x7f".repeat(prefix.length)}${name}/`;
  // Ohne Anführungszeichen liest die Shell ein Leerzeichen als Argumentgrenze.
  return quoted ? insert : insert.replace(/ /g, "\\ ");
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
