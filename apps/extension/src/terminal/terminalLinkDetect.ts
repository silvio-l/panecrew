// Ausgelagert aus usePtyTerminal.ts, damit die Erkennung isoliert testbar ist
// — dieselbe Konvention wie resizeGate.ts/clipboard.ts. Reine Funktion ohne
// xterm/DOM-Bezug: bildet eine Zeile Terminal-Text auf klickbare Spannen ab,
// analog zu suggestion.ts' Textparsing.
//
// Bewusst nur absolute Pfade (POSIX + Windows-Laufwerksbuchstabe), keine
// relativen — PaneCrew kennt für alte Scrollback-Zeilen das damals gültige
// Arbeitsverzeichnis der Pane nicht mehr und würde sonst falsch raten.

type TerminalLinkType = "url" | "absolute-path";

export interface TerminalLink {
  type: TerminalLinkType;
  start: number;
  end: number;
  text: string;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'`]*/g;
// Kein Doppelpunkt im Zeichensatz: eine Stack-Trace-Zeile wie
// "/pfad/datei.ts:42:10" soll nur den Datei-Pfad selbst als Link liefern,
// die Zeilen-/Spaltenangabe dahinter bleibt einfacher Text (kein
// line:col-Sprungziel in v1, siehe Spec). Das Lookbehind verhindert, dass
// ein `/` MITTEN in einem relativen Pfad ("src/main.ts") oder hinter `~`/`.`
// ("~/foo", "./foo", "../foo") fälschlich als Start eines absoluten Pfads
// zählt — nur ein `/` ohne Wortzeichen/`.`/`~` direkt davor gilt als
// Pfadanfang.
const POSIX_PATH_PATTERN = /(?<![\w./~])\/[^\s"'`:]+/g;

// Schließende Klammern/Satzzeichen, die typischerweise NICHT mehr zum
// Link/Pfad selbst gehören, sondern zur umgebenden Prosa ("siehe /tmp/foo."
// oder "(https://example.com)") — dieselbe pragmatische Vereinfachung wie
// bei @xterm/addon-web-links' eigenem Regex.
const TRAILING_PUNCTUATION = /[),.;:!?\]}'"]+$/;

export function detectTerminalLinks(line: string): TerminalLink[] {
  const links: TerminalLink[] = [];

  for (const match of line.matchAll(URL_PATTERN)) {
    addMatch(links, [], match, "url");
  }

  // Nur bereits gefundene URLs abgleichen, nicht die Pfad-Treffer
  // untereinander: eine URL wie "https://x.test/a/b" enthält "/a/b" als
  // Teilstring, der sonst zusätzlich als eigener absoluter Pfad auftauchen
  // würde.
  const urlRanges = links.map((link) => [link.start, link.end] as const);

  for (const match of line.matchAll(WINDOWS_PATH_PATTERN)) {
    addMatch(links, urlRanges, match, "absolute-path");
  }
  for (const match of line.matchAll(POSIX_PATH_PATTERN)) {
    addMatch(links, urlRanges, match, "absolute-path");
  }

  return links.sort((a, b) => a.start - b.start);
}

function addMatch(
  links: TerminalLink[],
  excludeRanges: readonly (readonly [number, number])[],
  match: RegExpMatchArray,
  type: TerminalLinkType,
): void {
  const startIndex = match.index ?? 0;
  const trimmedText = match[0].replace(TRAILING_PUNCTUATION, "");
  if (trimmedText.length === 0) return;
  const start = startIndex;
  const end = startIndex + trimmedText.length;
  if (excludeRanges.some(([exStart, exEnd]) => start < exEnd && end > exStart)) {
    return;
  }
  links.push({ type, start, end, text: trimmedText });
}
