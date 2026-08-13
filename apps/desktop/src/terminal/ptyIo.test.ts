import { describe, expect, it } from "vitest";
import { createChunkDecoder, formatDroppedPaths } from "./ptyIo";

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));

describe("createChunkDecoder", () => {
  it("setzt ein an der Chunk-Grenze zerschnittenes Mehrbyte-Zeichen zusammen", () => {
    // "✔" ist 3 Byte lang; die PTY liefert die Bytes in beliebiger Stückelung.
    const all = bytes("ok ✔");
    const decode = createChunkDecoder();

    const first = decode(all.slice(0, 4));
    const second = decode(all.slice(4));

    expect(first + second).toBe("ok ✔");
    // Kein Ersatzzeichen: genau das würde ein pro Chunk neu erzeugter (oder
    // ohne stream:true benutzter) TextDecoder produzieren.
    expect(first + second).not.toContain("�");
  });

  it("hält eine über drei Chunks verteilte ANSI-Sequenz unverändert", () => {
    const all = bytes("\x1b[31mFehler\x1b[0m");
    const decode = createChunkDecoder();

    const joined = [all.slice(0, 2), all.slice(2, 7), all.slice(7)]
      .map(decode)
      .join("");

    expect(joined).toBe("\x1b[31mFehler\x1b[0m");
  });

  it("hält den Zustand pro Instanz getrennt", () => {
    const all = bytes("✔");
    const a = createChunkDecoder();
    const b = createChunkDecoder();

    // Eine halbe Sequenz in Decoder a darf Decoder b nicht beeinflussen.
    a(all.slice(0, 1));
    expect(b(all)).toBe("✔");
  });
});

describe("formatDroppedPaths", () => {
  it("lässt Pfade ohne Leerraum unangetastet", () => {
    expect(formatDroppedPaths(["/Users/dev/shot.png"])).toBe(
      "/Users/dev/shot.png",
    );
  });

  it("quotet Pfade mit Leerzeichen", () => {
    expect(formatDroppedPaths(["/Users/dev/My Screenshots/a b.png"])).toBe(
      "'/Users/dev/My Screenshots/a b.png'",
    );
  });

  it("bricht enthaltene einfache Anführungszeichen POSIX-konform aus", () => {
    expect(formatDroppedPaths(["/Users/dev/it's here/a.png"])).toBe(
      "'/Users/dev/it'\\''s here/a.png'",
    );
  });

  it("trennt mehrere Pfade durch ein Leerzeichen", () => {
    expect(formatDroppedPaths(["/a/one.png", "/b/two three.png"])).toBe(
      "/a/one.png '/b/two three.png'",
    );
  });

  it("liefert für ein leeres Drop nichts", () => {
    expect(formatDroppedPaths([])).toBe("");
  });

  // Der Kern der Erlaubnisliste: alles hier hätte die frühere Prüfung (nur
  // Leerraum) unquotiert durchgelassen, und jedes Zeichen davon hätte in der
  // Shell etwas anderes getan als "einen Pfad benennen".
  it.each([
    ["Dollar (Variablen-Expansion)", "/Users/dev/$HOME/a.png"],
    ["Kommandosubstitution in Backticks", "/Users/dev/`whoami`/a.png"],
    ["Kommandosubstitution per $()", "/Users/dev/$(id)/a.png"],
    ["Glob-Zeichen", "/Users/dev/log*/a.png"],
    ["Kommandotrenner", "/Users/dev/a;rm -rf b/c.png"],
    ["Hintergrund-Operator", "/Users/dev/a&b/c.png"],
    ["Pipe", "/Users/dev/a|b/c.png"],
    ["Umleitung", "/Users/dev/a>b/c.png"],
    ["Klammern", "/Users/dev/a(1)/c.png"],
    ["doppelte Anführungszeichen", '/Users/dev/a"b/c.png'],
    ["Backslash", "/Users/dev/a\\b/c.png"],
    ["Kommentarzeichen", "/Users/dev/a#b/c.png"],
    ["History-Expansion", "/Users/dev/a!b/c.png"],
    ["Tilde als Namensanfang", "/Users/dev/~backup/a.png"],
  ])("quotet %s", (_name, path) => {
    expect(formatDroppedPaths([path])).toBe(`'${path}'`);
  });

  // Die Gegenprobe, und der Grund für \p{L}/\p{N} statt A-Za-z0-9: ein Umlaut
  // ist für keine Shell ein Sonderzeichen. Würde er quotiert, wäre für einen
  // deutschsprachigen Nutzer der Ausnahmefall der Normalfall — samt der
  // Anführungszeichen, die ein TUI-Prompt als reine Zeichen anzeigt.
  it("lässt Pfade mit Umlauten und anderen Buchstaben unquotiert", () => {
    expect(formatDroppedPaths(["/Users/dev/Bücher/Größe-2.png"])).toBe(
      "/Users/dev/Bücher/Größe-2.png",
    );
    expect(formatDroppedPaths(["/Users/dev/日本語/a.png"])).toBe(
      "/Users/dev/日本語/a.png",
    );
  });
});
