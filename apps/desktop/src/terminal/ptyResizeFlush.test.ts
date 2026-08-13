import { Terminal } from "@xterm/xterm";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "./ptyResizeFlush.fixture.json";

// Regressionstest für die Korruption, die beim Öffnen des Slash-Menüs in
// einem realen CLI-Coding-Agenten beobachtet wurde: verschobener Text,
// Zeichen mitten im Wort auseinandergerissen, Cursor in leerem Bereich. Der
// Fix selbst bleibt tool-agnostisch (Ink-Style-Redraw-Muster), nur die
// Fixture-Bytes stammen aus einer realen Session (Provenienz unten).
//
// usePtyTerminal.ts selbst lässt sich hier nicht Ende-zu-Ende ansteuern:
// jsdom stubbt ResizeObserver als No-Op (src/test/setup.ts) und liefert für
// jedes Element offsetWidth/-Height 0, FitAddon.fit() könnte also nie eine
// echte Spaltenänderung auslösen. Getestet wird deshalb der Mechanismus
// direkt, mit demselben xterm.js-Kern wie die Produktion (kein Mock, siehe
// inlineSuggestion.test.ts) und echten, aufgezeichneten Bytes einer
// `claude`-Session (Fixture, siehe deren _comment). brandlint-ok: dokumentiert das reale CLI-Tool der Aufnahme, notwendige Provenienz.
// pendingOutput, das VOR einem Resize aus der PTY eintraf, muss auch VOR dem
// Reflow geschrieben werden — sonst landen für die alte Spaltenzahl
// berechnete Bytes in einem bereits umgebrochenen Puffer.
//
// Der Fix in usePtyTerminal.ts ist `flushOutput()` unmittelbar vor jedem
// tatsächlichen `terminal.resize()` — seit resizeGate.ts an genau einer
// Stelle (dessen `applyResize`-Callback), zuvor an den beiden Call-Sites
// (Pane-Zoom, ResizeObserver) dupliziert. Dieselbe Reihenfolge wie im
// "fixed"-Fall unten. resizeGate.ts selbst schließt eine zweite Lücke, die
// dieser Test nicht abdeckt: wiederholte Spaltenänderungen einer einzigen
// Drag-Geste, siehe dortiger Kopfkommentar.

const { cols, rows, prefixHex, burstHex } = fixture;

function hexToString(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

const prefix = hexToString(prefixHex);
const burst = hexToString(burstHex);
const NEW_COLS = 60;

function makeTerminal(): Terminal {
  const container = document.createElement("div");
  document.body.append(container);
  const terminal = new Terminal({ cols, rows, allowProposedApi: true });
  terminal.open(container);
  return terminal;
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function visibleLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < terminal.rows; y += 1) {
    lines.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? "");
  }
  return lines;
}

// xterm fragt beim Öffnen das Device-Pixel-Ratio über eine Media Query ab;
// jsdom hat matchMedia nicht (wie in inlineSuggestion.test.ts).
beforeAll(() => {
  window.matchMedia = (query) =>
    ({
      matches: false,
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

describe("PTY-Ausgabe über einen Resize hinweg (Terminal-Korruption beim Slash-Menü)", () => {
  it("reflowt für die alte Spaltenzahl berechnete Bytes falsch, wenn resize() VOR dem Schreiben läuft (Bug-Reihenfolge)", async () => {
    const terminal = await (async () => {
      const t = makeTerminal();
      await write(t, prefix);
      return t;
    })();

    terminal.resize(NEW_COLS, rows);
    await write(terminal, burst);

    // Normaler Zeilenumbruch trennt nie mitten im Wort -- eine ohne Trenner
    // aneinandergehängte Zeilenfolge rekonstruiert den Originaltext also auch
    // über einen Umbruch hinweg (siehe Fix-Test unten). Bei echter
    // Korruption gilt das nicht mehr: das Wort landet zerrissen in falschen,
    // nicht benachbarten Zeilen.
    const lines = visibleLines(terminal);
    const joinedAcrossWraps = lines.join("");
    expect(joinedAcrossWraps).not.toContain("sharpen a plan or");
  });

  it("bleibt lesbar, wenn resize() ERST NACH dem Flush ausstehender Ausgabe läuft (Fix-Reihenfolge)", async () => {
    const terminal = makeTerminal();
    await write(terminal, prefix);
    await write(terminal, burst);
    terminal.resize(NEW_COLS, rows);

    const lines = visibleLines(terminal);
    // Bei 60 Spalten reflowt "sharpen a plan or" ganz normal mitten im Wort
    // um ("...to shar" / "pen a plan or...") -- das ist gewöhnlicher
    // Zeilenumbruch, keine Korruption: ohne Trenner aneinandergehängt ergibt
    // die Zeilenfolge wieder den zusammenhängenden Originaltext.
    const joinedAcrossWraps = lines.join("");
    expect(joinedAcrossWraps).toContain(
      "A relentless interview to sharpen a plan or",
    );
  });
});
