// Reine Aufbereitung zwischen rohen PTY-Bytes und Terminal-Text — bewusst
// ohne React- und ohne xterm.js-Import, damit dieser Teil isoliert (und ohne
// jsdom-Canvas-Attrappen) testbar bleibt.

/**
 * Streaming-Decoder für die rohen PTY-Bytes EINER Pane. Bewusst eine Factory:
 * die zurückgegebene Funktion schließt über genau eine TextDecoder-Instanz,
 * die über alle Chunks hinweg dieselbe bleibt.
 *
 * Eine Chunk-Grenze kann mitten in einem UTF-8-Codepoint oder einer
 * ANSI-Sequenz liegen. `{ stream: true }` ist dabei genauso wesentlich wie die
 * Wiederverwendung der Instanz — ohne das Flag setzt decode() den Decoder nach
 * jedem Aufruf zurück und ersetzt den angefangenen Codepoint durch U+FFFD.
 * Genau diese Ausgabe erzeugen die TUIs, für die PaneCrew gebaut ist.
 */
export function createChunkDecoder(): (bytes: ArrayBuffer | number[]) => string {
  const decoder = new TextDecoder("utf-8");
  return (bytes) => decoder.decode(new Uint8Array(bytes), { stream: true });
}

/**
 * Fallengelassene Dateipfade als Terminal-Eingabe. Pfade mit Leerraum werden
 * POSIX-konform in einfache Anführungszeichen gesetzt (enthaltene ' werden
 * korrekt ausgebrochen). In einem TUI-Prompt (Claude Code) landen die
 * Anführungszeichen als reine Zeichen — das ist der gewollte Kompromiss, weil
 * derselbe Text in einer Shell sonst in mehrere Argumente zerfiele. Die
 * Quotierung ist POSIX-Syntax; für Windows-Shells ist sie unverifiziert
 * (kein Testgerät, siehe v0.1-Scope).
 */
export function formatDroppedPaths(paths: readonly string[]): string {
  return paths.map(quoteForShell).join(" ");
}

function quoteForShell(path: string): string {
  if (!/\s/.test(path)) return path;
  return `'${path.replaceAll("'", "'\\''")}'`;
}
