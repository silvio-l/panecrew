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
 * Fallengelassene Dateipfade als Terminal-Eingabe. Pfade, die nicht komplett
 * aus unbedenklichen Zeichen bestehen, werden POSIX-konform in einfache
 * Anführungszeichen gesetzt (enthaltene ' werden korrekt ausgebrochen). In
 * einem TUI-Prompt (Ink-basierter Agent) landen die Anführungszeichen als
 * reine Zeichen — das ist der gewollte Kompromiss, weil derselbe Text in einer
 * Shell sonst in mehrere Argumente zerfiele oder, schlimmer, teilweise
 * ausgeführt würde. Die Quotierung ist POSIX-Syntax; für Windows-Shells ist
 * sie unverifiziert (kein Testgerät, siehe v0.1-Scope).
 *
 * Ein Weg für beide Drop-Quellen: den Drop aus dem Finder
 * (`useWebviewFileDrop.ts`) und das Ziehen aus dem eigenen Explorer
 * (`useExplorerPathDrag.ts`). Es gibt bewusst keine zweite Quotierregel für
 * die zweite Quelle — beide enden im selben Terminal, für dasselbe Shell.
 */
export function formatDroppedPaths(paths: readonly string[]): string {
  return paths.map(quoteForShell).join(" ");
}

// Erlaubnisliste statt Verbotsliste. Der frühere Test war `/\s/` — also nur
// Leerraum — und ließ damit jedes Zeichen durch, das eine Shell auswertet:
// `$HOME` in einem Ordnernamen wurde expandiert, ein Backtick oder `$(…)`
// startete eine Kommandosubstitution, `*`/`?` wurden zu Globs, `;`/`&`/`|`
// zerlegten die Zeile in mehrere Kommandos. Ein Verbotsliste wäre dieselbe
// Wette noch einmal: sie muss vollständig sein, um zu schützen, während die
// Erlaubnisliste bei jedem vergessenen Zeichen nur unnötig quotiert.
//
// Buchstaben und Ziffern stehen als Unicode-Klassen darin, nicht als
// `A-Za-z0-9`: ein Umlaut ist für keine Shell ein Sonderzeichen, und ein
// deutscher Nutzer hätte sonst "quotiert" als Normalfall statt als Ausnahme —
// mitsamt der oben beschriebenen sichtbaren Anführungszeichen im TUI-Prompt.
// Der Punkt der Quotierung ist die Shell-Bedeutung, nicht das Alphabet.
//
// `~` fehlt in der Liste absichtlich: am Wortanfang ist es Tilde-Expansion.
// Ein Pfad, der damit anfängt, ist hier ohnehin absolut (also `/…`), aber ein
// Ordner NAMENS `~backup` soll nicht stillschweigend zum Heimatverzeichnis
// eines Nutzers werden.
const SHELL_SAFE = /^[\p{L}\p{N}._/@%+:,=-]+$/u;

function quoteForShell(path: string): string {
  if (SHELL_SAFE.test(path)) return path;
  return `'${path.replaceAll("'", "'\\''")}'`;
}
