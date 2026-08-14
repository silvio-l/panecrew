// Ausgelagert aus usePtyTerminal.ts, damit beides isoliert testbar ist —
// dieselbe Konvention wie resizeGate.ts.

/**
 * Entfernt die gemeinsame führende Einrückung aller nicht-leeren Zeilen —
 * dieselbe Idee wie Pythons textwrap.dedent(). Bewusst tool-agnostisch: kein
 * Wissen über ein bestimmtes CLI-Tool, nur eine generische Bereinigung des
 * Rand-Einzugs, den verschachtelte Terminal-/Box-UIs vor jede Zeile setzen.
 * Nur bei mehrzeiligen Selektionen aufgerufen
 * (siehe copySelectionFrom) — bei einer einzelnen Zeile wäre deren
 * Einrückung eher Inhalt als Rahmen, ein Dedent dort würde sie ersatzlos
 * kappen.
 */
export function dedentText(text: string): string {
  const lines = text.split("\n");
  const nonBlank = lines.filter((line) => line.trim().length > 0);
  if (nonBlank.length === 0) return text;
  const commonIndent = longestCommonLeadingWhitespace(nonBlank);
  if (commonIndent.length === 0) return text;
  return lines
    .map((line) =>
      line.trim().length > 0 ? line.slice(commonIndent.length) : line,
    )
    .join("\n");
}

function longestCommonLeadingWhitespace([first, ...rest]: string[]): string {
  let prefix = /^[ \t]*/.exec(first ?? "")?.[0] ?? "";
  for (const line of rest) {
    const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
    let i = 0;
    while (i < prefix.length && i < indent.length && prefix[i] === indent[i]) {
      i++;
    }
    prefix = prefix.slice(0, i);
    if (prefix === "") break;
  }
  return prefix;
}

/**
 * Schreibt Text in die System-Zwischenablage und meldet — synchron und
 * verlässlich, anders als navigator.clipboard.writeText() — ob es wirklich
 * geklappt hat.
 *
 * document.execCommand("copy") läuft bewusst als PRIMÄRER statt als
 * Fallback-Pfad: der gemeldete Bug (Kopiert-Quittung erscheint, die
 * Zwischenablage bleibt aber leer) betraf ausschließlich die beiden Pfade,
 * die zuvor navigator.clipboard.writeText() aufriefen (Mausauswahl,
 * Kontextmenü) — natives Cmd+C (xterms eigenes `copy`-ClipboardEvent, App-
 * Code komplett außen vor) funktionierte immer. WKWebView ist bei der Async
 * Clipboard API nachweislich strenger als andere Engines darin, was noch als
 * direkte User-Geste zählt — u. a. verliert ein Callback, der erst nach der
 * Schließ-Animation eines Radix-Kontextmenüs feuert, die "transient
 * activation" wieder, und dasselbe Zeitfenster-Problem trifft offenbar auch
 * den `mouseup`-Handler der Mausauswahl. document.execCommand("copy") läuft
 * stattdessen synchron über dieselbe browser-native Kopiermechanik wie
 * natives Cmd+C und meldet Erfolg/Fehlschlag synchron zurück statt über ein
 * Promise, dessen Ablehnung der bisherige Code (`.catch(noop)`) gar nicht
 * erst ausgewertet hat — genau das ließ die "Kopiert"-Quittung unabhängig
 * vom tatsächlichen Ergebnis feuern.
 */
export function copyTextToClipboard(text: string): boolean {
  if (tryExecCommandCopy(text)) return true;
  // Umgebungen ganz ohne execCommand: bestmöglicher Versuch im Hintergrund,
  // aber ohne Erfolgsgarantie — deshalb hier `false`, kein Kopiert-Toast auf
  // Verdacht.
  // Laufzeit-Guard trotz nicht-optionalem DOM-Typ: in Umgebungen ohne
  // execCommand (z. B. jsdom in Tests) fehlt oft auch navigator.clipboard.
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard) {
    void clipboard.writeText(text).catch(() => {
      /* kein zweiter Fallback mehr übrig */
    });
  }
  return false;
}

// execCommand("copy") ist als Web-Standard deprecated, aber bewusst gewählt
// (siehe copyTextToClipboard()) — es ist der einzige synchron auswertbare
// Kopierweg, den WKWebView zuverlässig unterstützt, und genau deshalb hier
// im Einsatz statt der ebenfalls verfügbaren, aber nachweislich unzuverlässigen
// Async Clipboard API.
function tryExecCommandCopy(text: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (typeof document.execCommand !== "function") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  // Off-screen statt display:none — ausgeblendete Elemente lassen sich in
  // manchen Engines nicht selektieren, execCommand("copy") braucht aber eine
  // echte Selektion.
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.setAttribute("readonly", "");
  document.body.appendChild(textarea);
  const previouslyFocused = document.activeElement as HTMLElement | null;
  textarea.focus();
  textarea.select();
  let succeeded: boolean;
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  }
  document.body.removeChild(textarea);
  // Fokus zurück ins Terminal — sonst unterbricht ein Copy-on-Select
  // (mouseup) die Eingabe, weil unsere temporäre Textarea den Fokus behält.
  previouslyFocused?.focus();
  return succeeded;
}
