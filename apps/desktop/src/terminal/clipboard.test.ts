import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard, dedentText } from "./clipboard";

describe("dedentText", () => {
  it("entfernt die gemeinsame führende Einrückung über alle nicht-leeren Zeilen", () => {
    const input = "  foo\n  bar\n\n  baz";
    expect(dedentText(input)).toBe("foo\nbar\n\nbaz");
  });

  it("bricht die gemeinsame Einrückung an der Zeile ohne sie ab", () => {
    const input = "  foo\nbar";
    expect(dedentText(input)).toBe(input);
  });

  it("lässt bereits randbündigen Text unverändert", () => {
    const input = "foo\nbar";
    expect(dedentText(input)).toBe(input);
  });

  it("erkennt Tab- und Space-Einrückung nicht als gemeinsames Präfix", () => {
    const input = "\tfoo\n  bar";
    expect(dedentText(input)).toBe(input);
  });
});

describe("copyTextToClipboard", () => {
  // jsdom implementiert execCommand nicht (kein Aufruf zum Spionieren
  // vorhanden) — die reale Bereinigungsmechanik testet ohnehin nur der
  // Dogfood-Build selbst, hier zählt nur das Zusammenspiel mit dem
  // Rückgabewert.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- nur der Typ wird referenziert, siehe clipboard.ts für die Begründung
  let execCommand: ReturnType<typeof vi.fn<typeof document.execCommand>>;

  beforeEach(() => {
    execCommand = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand = execCommand;
  });

  it("meldet Erfolg, wenn execCommand('copy') geklappt hat", () => {
    execCommand.mockReturnValue(true);
    expect(copyTextToClipboard("hallo")).toBe(true);
  });

  it("meldet Fehlschlag statt einer Kopiert-Quittung auf Verdacht, wenn execCommand('copy') scheitert", () => {
    execCommand.mockReturnValue(false);
    expect(copyTextToClipboard("hallo")).toBe(false);
  });

  it("räumt die temporäre Textarea in jedem Fall wieder auf", () => {
    execCommand.mockReturnValue(true);
    copyTextToClipboard("hallo");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("gibt den Fokus nach dem Kopieren an das vorher fokussierte Element zurück", () => {
    execCommand.mockReturnValue(true);
    const previously = document.createElement("button");
    document.body.appendChild(previously);
    previously.focus();

    copyTextToClipboard("hallo");

    expect(document.activeElement).toBe(previously);
    document.body.removeChild(previously);
  });
});
