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
});
