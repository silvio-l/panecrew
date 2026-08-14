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
    fontSize: Number.isFinite(fontSize) ? fontSize : 14,
    lineHeight: Number.isFinite(lineHeight) ? lineHeight : 1.65,
  };
}

/**
 * Der Theme-Umschalter existiert jetzt (Settings-System, `appearance.theme`)
 * — `usePtyTerminal.ts` beobachtet `data-theme` per MutationObserver und
 * ruft diese Funktion bei jedem Wechsel erneut auf, um bereits laufende
 * xterm-Instanzen nachzuziehen (sie lesen die Tokens sonst nur einmal, bei
 * Konstruktion). Die Auswahlfarbe kommt aus dem eigenen
 * Marken-Amber-Token --pc-terminal-selectionBackground, nicht aus dem
 * neutralen Listen-Token und nicht direkt aus --pc-focusBorder (Nutzerwunsch
 * 2026-08-12: Auswahl soll optisch als PaneCrew-Amber erkennbar sein — die
 * Herleitung, warum das den Direction-Contract-Grundsatz "Akzent gehört dem
 * Fokus" nicht verletzt, steht bei der Token-Definition in theme.css).
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
    selectionBackground: readToken("--pc-terminal-selectionBackground"),
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
