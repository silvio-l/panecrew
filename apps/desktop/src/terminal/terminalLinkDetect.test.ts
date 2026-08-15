import { describe, expect, it } from "vitest";
import { detectTerminalLinks } from "./terminalLinkDetect";

describe("detectTerminalLinks", () => {
  it("erkennt eine bloße URL", () => {
    const text = "https://example.com/docs";
    expect(detectTerminalLinks(text)).toEqual([
      { type: "url", start: 0, end: text.length, text },
    ]);
  });

  it("erkennt einen absoluten POSIX-Pfad", () => {
    const text = "/Users/silvio/panecrew/README.md";
    expect(detectTerminalLinks(text)).toEqual([
      { type: "absolute-path", start: 0, end: text.length, text },
    ]);
  });

  it("erkennt einen Windows-Laufwerksbuchstaben-Pfad", () => {
    const text = "C:\\Users\\silvio\\panecrew";
    expect(detectTerminalLinks(text)).toEqual([
      { type: "absolute-path", start: 0, end: text.length, text },
    ]);
  });

  it("erkennt einen relativen Pfad NICHT", () => {
    expect(detectTerminalLinks("src/main.ts geändert")).toEqual([]);
  });

  it("erkennt home- und dot-relative Pfade NICHT (~/, ./, ../)", () => {
    expect(detectTerminalLinks("~/foo ./bar ../baz")).toEqual([]);
  });

  it("grenzt die klickbare Spanne innerhalb einer längeren Zeile korrekt ab", () => {
    const path = "/Users/silvio/panecrew/README.md";
    const line = `siehe ${path} für Details`;
    const start = line.indexOf(path);
    expect(detectTerminalLinks(line)).toEqual([
      { type: "absolute-path", start, end: start + path.length, text: path },
    ]);
  });

  it("schneidet umschließende Satzzeichen vom Link ab", () => {
    const url = "https://example.com/docs";
    const line = `(siehe ${url}).`;
    const start = line.indexOf(url);
    expect(detectTerminalLinks(line)).toEqual([
      { type: "url", start, end: start + url.length, text: url },
    ]);
  });

  it("lässt Zeilen-/Spaltenangaben hinter einem Pfad außen vor", () => {
    const path = "/src/App.tsx";
    const line = `Fehler in ${path}:42:10`;
    const start = line.indexOf(path);
    expect(detectTerminalLinks(line)).toEqual([
      { type: "absolute-path", start, end: start + path.length, text: path },
    ]);
  });

  it("zählt einen Pfad-Anteil innerhalb einer URL nicht doppelt als eigenen Link", () => {
    const text = "https://example.com/a/b/c";
    expect(detectTerminalLinks(text)).toEqual([
      { type: "url", start: 0, end: text.length, text },
    ]);
  });

  it("erkennt mehrere Links in derselben Zeile in Lesereihenfolge", () => {
    const line = "GET https://example.com/api von /var/log/app.log geloggt";
    const links = detectTerminalLinks(line);
    expect(links.map((link) => link.text)).toEqual([
      "https://example.com/api",
      "/var/log/app.log",
    ]);
  });
});
