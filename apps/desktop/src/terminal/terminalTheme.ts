import type { ITheme } from "@xterm/xterm";

// xterm-Optionen/-Theme aus den bestehenden --pc-terminal-*-Tokens
// (theme.css ist die einzige Farbquelle, damit Light/Dark weiter
// funktioniert). Eigene Datei statt Teil von usePtyTerminal.ts: reines
// CSS-Token-Lesen, keine Lebenszyklus-Logik — dieselbe Trennung wie bei
// ptyIo.ts.

function readToken(name: string): string | undefined {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    undefined
  );
}

export function readTerminalOptions(): {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
} {
  const fontSize = Number.parseFloat(readToken("--pc-terminal-fontSize") ?? "");
  const lineHeight = Number.parseFloat(
    readToken("--pc-terminal-lineHeight") ?? "",
  );
  return {
    fontFamily: readToken("--pc-terminal-fontFamily") ?? "ui-monospace",
    fontSize: Number.isFinite(fontSize) ? fontSize : 12,
    lineHeight: Number.isFinite(lineHeight) ? lineHeight : 1.65,
  };
}

/**
 * Bewusst ohne MutationObserver auf data-theme: es gibt noch keinen
 * Theme-Umschalter, den er beobachten könnte — dann ist er hinzuzufügen,
 * nicht jetzt auf Vorrat. Die Auswahlfarbe kommt aus dem neutralen
 * Listen-Token, nie aus dem Fokus-Akzent: der Akzent ist laut Direction
 * Contract ausschließlich für Fokus reserviert.
 *
 * Ein nicht auflösbares Token liefert bewusst undefined statt "": jedes Feld
 * von ITheme ist optional, xterm nimmt dann seinen eigenen Default — ein
 * leerer String dagegen würde beim Parsen als ungültige Farbe werfen und die
 * ganze Pane mitreißen.
 */
export function readTerminalTheme(): ITheme {
  return {
    background: readToken("--pc-terminal-background"),
    foreground: readToken("--pc-terminal-foreground"),
    cursor: readToken("--pc-terminal-cursor"),
    cursorAccent: readToken("--pc-terminal-background"),
    selectionBackground: readToken("--pc-list-activeSelectionBackground"),
    scrollbarSliderBackground: readToken("--pc-list-hoverBackground"),
    scrollbarSliderHoverBackground: readToken(
      "--pc-list-activeSelectionBackground",
    ),
    black: readToken("--pc-terminal-ansiBlack"),
    red: readToken("--pc-terminal-ansiRed"),
    green: readToken("--pc-terminal-ansiGreen"),
    yellow: readToken("--pc-terminal-ansiYellow"),
    blue: readToken("--pc-terminal-ansiBlue"),
    magenta: readToken("--pc-terminal-ansiMagenta"),
    cyan: readToken("--pc-terminal-ansiCyan"),
    white: readToken("--pc-terminal-ansiWhite"),
    brightBlack: readToken("--pc-terminal-ansiBrightBlack"),
    brightRed: readToken("--pc-terminal-ansiBrightRed"),
    brightGreen: readToken("--pc-terminal-ansiBrightGreen"),
    brightYellow: readToken("--pc-terminal-ansiBrightYellow"),
    brightBlue: readToken("--pc-terminal-ansiBrightBlue"),
    brightMagenta: readToken("--pc-terminal-ansiBrightMagenta"),
    brightCyan: readToken("--pc-terminal-ansiBrightCyan"),
    brightWhite: readToken("--pc-terminal-ansiBrightWhite"),
  };
}
