import { Terminal } from "@xterm/xterm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  committedLineCount,
  disposeTerminalActivity,
  isTabUnread,
  isTerminalActive,
  markTabViewed,
  reportLineAdvance,
  resetTerminalActivityForTests,
  setActivityIdleMs,
  setActivityLineThreshold,
} from "./terminalActivity";

// committedLineCount() ist der Teil, den usePtyTerminal.ts tatsächlich VOR und
// NACH jedem terminal.write() aufruft — getestet mit einem echten xterm.js-
// Kern statt eines Mocks, gleiches Vorgehen wie ptyResizeFlush.test.ts.

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
function makeTerminal(cols = 20, rows = 4): Terminal {
  const container = document.createElement("div");
  document.body.append(container);
  const terminal = new Terminal({ cols, rows, allowProposedApi: true });
  terminal.open(container);
  return terminal;
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

describe("committedLineCount", () => {
  it("wächst, wenn ein Zeilenumbruch neuen Zeileninhalt committet", async () => {
    const terminal = makeTerminal();
    const before = committedLineCount(terminal);
    await write(terminal, "erste Zeile\r\nzweite Zeile\r\n");
    const after = committedLineCount(terminal);
    if (before === null || after === null) {
      throw new Error("erwartete den normalen Puffer, nicht den Alternate-Puffer");
    }
    expect(after).toBeGreaterThan(before);
  });

  it("bleibt unverändert bei einem reinen In-Place-Redraw (Spinner-Muster)", async () => {
    const terminal = makeTerminal();
    await write(terminal, "prompt> ");
    const before = committedLineCount(terminal);
    // Carriage Return ohne Linefeed: derselbe Zeilenanfang wird neu
    // überschrieben, wie es ein Ink-Spinner tut — genau der Fall, an dem ein
    // reiner Zeichen-Diff fälschlich "aktiv" bliebe.
    await write(terminal, "\rprompt> |");
    await write(terminal, "\rprompt> /");
    const after = committedLineCount(terminal);
    expect(after).toBe(before);
  });

  it("liefert null im Alternate-Puffer (Fullscreen-TUI wie vim/htop)", async () => {
    const terminal = makeTerminal();
    await write(terminal, "\x1b[?1049h"); // Alternate-Puffer aktivieren
    expect(committedLineCount(terminal)).toBeNull();
  });
});

describe("reportLineAdvance / isTerminalActive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    disposeTerminalActivity("tab-a");
    disposeTerminalActivity("tab-b");
    // Module-globale Schwellen zurücksetzen — sonst leckt eine in einem Test
    // gesetzte Schwelle in nachfolgende Tests (setActivityIdleMs/
    // setActivityLineThreshold sind bewusst modul-global, s. Kopfkommentar
    // von terminalActivity.ts).
    setActivityIdleMs(1500);
    setActivityLineThreshold(1);
  });

  it("ist inaktiv, solange kein Fortschritt gemeldet wurde", () => {
    expect(isTerminalActive("tab-a")).toBe(false);
  });

  it("wird aktiv, sobald neue Zeilen gemeldet werden", () => {
    reportLineAdvance("tab-a", 3);
    expect(isTerminalActive("tab-a")).toBe(true);
  });

  it("ignoriert eine Meldung ohne tatsächlichen Fortschritt", () => {
    reportLineAdvance("tab-a", 0);
    expect(isTerminalActive("tab-a")).toBe(false);
  });

  it("fällt nach der Idle-Schwelle ohne weiteren Fortschritt zurück auf inaktiv", () => {
    reportLineAdvance("tab-a", 1);
    expect(isTerminalActive("tab-a")).toBe(true);
    vi.advanceTimersByTime(1499);
    expect(isTerminalActive("tab-a")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isTerminalActive("tab-a")).toBe(false);
  });

  it("verlängert die Idle-Schwelle bei fortlaufendem Nachschub, statt vorzeitig zu kippen", () => {
    reportLineAdvance("tab-a", 1);
    vi.advanceTimersByTime(1000);
    reportLineAdvance("tab-a", 1);
    vi.advanceTimersByTime(1000);
    expect(isTerminalActive("tab-a")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(isTerminalActive("tab-a")).toBe(false);
  });

  it("hält Tabs unabhängig auseinander", () => {
    reportLineAdvance("tab-a", 1);
    expect(isTerminalActive("tab-a")).toBe(true);
    expect(isTerminalActive("tab-b")).toBe(false);
  });

  it("disposeTerminalActivity räumt Zustand UND den laufenden Idle-Timer auf", () => {
    reportLineAdvance("tab-a", 1);
    expect(vi.getTimerCount()).toBe(1);
    disposeTerminalActivity("tab-a");
    expect(isTerminalActive("tab-a")).toBe(false);
    // Kein herrenloser Timer mehr im Umlauf — sonst erbte ein
    // wiederverwendetes tabId dessen späteren Feuer-Effekt.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("setActivityLineThreshold verlangt erst den erhöhten Zeilen-Nachschub, bevor ein Tab als aktiv gilt", () => {
    setActivityLineThreshold(3);
    reportLineAdvance("tab-a", 1);
    expect(isTerminalActive("tab-a")).toBe(false);
    reportLineAdvance("tab-a", 1);
    expect(isTerminalActive("tab-a")).toBe(false);
    reportLineAdvance("tab-a", 1);
    expect(isTerminalActive("tab-a")).toBe(true);
  });

  it("Zeilen, die außerhalb des Idle-Fensters ankommen, akkumulieren nicht über das Fenster hinweg", () => {
    setActivityLineThreshold(3);
    reportLineAdvance("tab-a", 1);
    vi.advanceTimersByTime(1501);
    // Zähler ist verfallen — die folgenden 2 Zeilen reichen für sich allein
    // nicht an die Schwelle heran, obwohl 1 + 2 = 3 wäre.
    reportLineAdvance("tab-a", 2);
    expect(isTerminalActive("tab-a")).toBe(false);
  });

  it("setActivityIdleMs verändert, wie lange ein aktiver Tab braucht, um zurückzufallen", () => {
    setActivityIdleMs(500);
    reportLineAdvance("tab-a", 1);
    expect(isTerminalActive("tab-a")).toBe(true);
    vi.advanceTimersByTime(499);
    expect(isTerminalActive("tab-a")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isTerminalActive("tab-a")).toBe(false);
  });
});

// unread/markTabViewed/viewedTabId: Umbau 2026-08-13 (Nutzer-Neuspezifikation,
// s. Kopfkommentar dieser Datei zu `viewedTabId`) — persistenter Zustand,
// unabhängig von `active`/`idleMs` oben, s. dortige Tests.
describe("unread / markTabViewed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetTerminalActivityForTests();
  });

  it("wird erst unread, nachdem sowohl das Idle- als auch das Start-Ruhefenster abgelaufen sind", () => {
    // Frischer Eintrag, sofort aktiv — aber noch innerhalb des Start-
    // Ruhefensters (jede frisch gespawnte Shell druckt sofort ihren Prompt,
    // s. Kommentar an UNREAD_BOOT_GRACE_MS).
    reportLineAdvance("tab-a", 1);
    expect(isTabUnread("tab-a")).toBe(false);

    vi.advanceTimersByTime(1500);
    expect(isTerminalActive("tab-a")).toBe(false);
    expect(isTabUnread("tab-a")).toBe(false);

    // Neuer Burst, jetzt außerhalb des Start-Ruhefensters.
    reportLineAdvance("tab-a", 1);
    expect(isTabUnread("tab-a")).toBe(true);
  });

  it("verfällt NICHT durch Zeitablauf, anders als active", () => {
    reportLineAdvance("tab-a", 1);
    vi.advanceTimersByTime(1500);
    reportLineAdvance("tab-a", 1);
    expect(isTabUnread("tab-a")).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(isTerminalActive("tab-a")).toBe(false);
    expect(isTabUnread("tab-a")).toBe(true);
  });

  it("markiert unread nicht auf dem aktuell angesehenen Tab, wohl aber auf jedem anderen", () => {
    reportLineAdvance("tab-a", 1);
    reportLineAdvance("tab-b", 1);
    vi.advanceTimersByTime(1500);
    markTabViewed("tab-a");

    reportLineAdvance("tab-a", 1);
    reportLineAdvance("tab-b", 1);

    expect(isTabUnread("tab-a")).toBe(false);
    expect(isTabUnread("tab-b")).toBe(true);
  });

  it("markTabViewed löscht ein bereits gesetztes unread sofort", () => {
    reportLineAdvance("tab-a", 1);
    vi.advanceTimersByTime(1500);
    reportLineAdvance("tab-a", 1);
    expect(isTabUnread("tab-a")).toBe(true);

    markTabViewed("tab-a");
    expect(isTabUnread("tab-a")).toBe(false);
  });

  it("resetTerminalActivityForTests setzt auch viewedTabId zurück", () => {
    reportLineAdvance("tab-a", 1);
    vi.advanceTimersByTime(1500);
    markTabViewed("tab-a");
    resetTerminalActivityForTests();

    reportLineAdvance("tab-a", 1); // frischer Eintrag nach dem Reset
    vi.advanceTimersByTime(1500); // Idle- UND Start-Ruhefenster vorbei
    reportLineAdvance("tab-a", 1);
    // Ohne Rücksetzen bliebe "tab-a" weiterhin der angesehene Tab und
    // unterdrückte unread dauerhaft — genau das Leck-Risiko, gegen das
    // dieser Test wacht.
    expect(isTabUnread("tab-a")).toBe(true);
  });
});
