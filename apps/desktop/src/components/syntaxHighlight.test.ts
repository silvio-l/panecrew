import { describe, expect, it } from "vitest";
import {
  languageForPath,
  tokenizeLines,
  type Token,
} from "./syntaxHighlight";

function kinds(tokens: readonly Token[]): string[] {
  return tokens.map((token) => `${token.kind}:${token.text}`);
}

describe("languageForPath", () => {
  it.each([
    ["src/App.tsx", "ts"],
    ["src/App.ts", "ts"],
    ["src/index.js", "js"],
    ["src/index.jsx", "js"],
    ["src-tauri/src/main.rs", "rust"],
    ["package.json", "json"],
    ["docs/README.md", "markdown"],
    ["src/theme.css", "css"],
  ])("erkennt %s als %s", (path, expected) => {
    expect(languageForPath(path)).toBe(expected);
  });

  it("liefert null für eine unbekannte/fehlende Extension", () => {
    expect(languageForPath("Dockerfile")).toBeNull();
    expect(languageForPath("data.bin")).toBeNull();
  });
});

describe("tokenizeLines — unbekannte Sprache", () => {
  it("gibt jede Zeile als einen einzigen plain-Token zurück", () => {
    const lines = tokenizeLines("hello\nworld", null);
    expect(lines).toHaveLength(2);
    expect(kinds(lines[0] ?? [])).toEqual(["plain:hello"]);
    expect(kinds(lines[1] ?? [])).toEqual(["plain:world"]);
  });
});

describe("tokenizeLines — TypeScript", () => {
  it("erkennt Zeilenkommentare", () => {
    const [line] = tokenizeLines("// ein Kommentar", "ts");
    expect(kinds(line ?? [])).toEqual(["comment:// ein Kommentar"]);
  });

  it("erkennt Strings mit einfachen und doppelten Anführungszeichen", () => {
    const [line] = tokenizeLines(`const a = "hi"; const b = 'x';`, "ts");
    expect(kinds(line ?? [])).toContain('string:"hi"');
    expect(kinds(line ?? [])).toContain("string:'x'");
  });

  it("erkennt Keywords als eigenes Token, umgebender Text bleibt plain", () => {
    const [line] = tokenizeLines("const value = 1;", "ts");
    expect(kinds(line ?? [])[0]).toBe("keyword:const");
  });

  it("erkennt einen Block-Kommentar, der auf derselben Zeile endet", () => {
    const [line] = tokenizeLines("/* note */ const x = 1;", "ts");
    expect(kinds(line ?? [])[0]).toBe("comment:/* note */");
  });

  it("trägt einen mehrzeiligen Block-Kommentar über Zeilen hinweg fort", () => {
    const lines = tokenizeLines("/* start\nstill inside\nend */ const x = 1;", "ts");
    expect(kinds(lines[0] ?? [])).toEqual(["comment:/* start"]);
    expect(kinds(lines[1] ?? [])).toEqual(["comment:still inside"]);
    expect(kinds(lines[2] ?? [])[0]).toBe("comment:end */");
    expect(kinds(lines[2] ?? [])).toContain("keyword:const");
  });

  it("ignoriert einen Kommentar-Marker innerhalb eines Strings", () => {
    const [line] = tokenizeLines(`const url = "http://x";`, "ts");
    expect(kinds(line ?? [])).toContain('string:"http://x"');
  });
});

describe("tokenizeLines — Rust", () => {
  it("erkennt fn/let als Keywords und Strings", () => {
    const [line] = tokenizeLines(`fn main() { let s = "hi"; }`, "rust");
    expect(kinds(line ?? [])[0]).toBe("keyword:fn");
    expect(kinds(line ?? [])).toContain('string:"hi"');
    expect(kinds(line ?? []).some((k) => k.startsWith("keyword:let"))).toBe(true);
  });
});

describe("tokenizeLines — JSON", () => {
  it("erkennt Strings und die drei Literal-Keywords", () => {
    const [line] = tokenizeLines(`{"a": true, "b": null}`, "json");
    expect(kinds(line ?? [])).toContain('string:"a"');
    expect(kinds(line ?? [])).toContain("keyword:true");
    expect(kinds(line ?? [])).toContain("keyword:null");
  });
});

describe("tokenizeLines — CSS", () => {
  it("erkennt Block-Kommentare und Strings, keine Zeilenkommentare", () => {
    const [line] = tokenizeLines(`/* note */ content: "x";`, "css");
    expect(kinds(line ?? [])[0]).toBe("comment:/* note */");
    expect(kinds(line ?? [])).toContain('string:"x"');
  });
});

describe("tokenizeLines — Markdown", () => {
  it("färbt eine Überschriftenzeile komplett als keyword", () => {
    const [line] = tokenizeLines("## Titel", "markdown");
    expect(kinds(line ?? [])).toEqual(["keyword:## Titel"]);
  });

  it("erkennt Inline-Code zwischen Backticks als string, Rest bleibt plain", () => {
    const [line] = tokenizeLines("Nutze `pnpm test` dafür.", "markdown");
    expect(kinds(line ?? [])).toEqual([
      "plain:Nutze ",
      "string:`pnpm test`",
      "plain: dafür.",
    ]);
  });

  it("lässt eine normale Zeile ohne Sondersyntax vollständig plain", () => {
    const [line] = tokenizeLines("Ganz normaler Text.", "markdown");
    expect(kinds(line ?? [])).toEqual(["plain:Ganz normaler Text."]);
  });
});

describe("tokenizeLines — Performance an einer realen, großen Repo-Datei", () => {
  it("tokenisiert eine mehrere tausend Zeilen lange TSX-Datei in vertretbarer Zeit", () => {
    // `import.meta.glob` statt `node:fs` — derselbe Grund wie in
    // `cssEasingValidity.test.ts`: der src-tsconfig bleibt bewusst
    // browserseitig, kein Node-Typenimport hier.
    const files: Record<string, string> = import.meta.glob("../App.test.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const source = files["../App.test.tsx"];
    if (source === undefined) throw new Error("App.test.tsx nicht gefunden");
    expect(source.split("\n").length).toBeGreaterThan(1000);

    const start = performance.now();
    const lines = tokenizeLines(source, "ts");
    const elapsedMs = performance.now() - start;

    expect(lines).toHaveLength(source.split("\n").length);
    // Großzügige Schranke für einen vollen Rescan bei jedem Tastendruck (die
    // eigentliche Kosten-Einsparung kommt aus dem gefensterten Rendern in
    // FileEditor.tsx, s. dortiger Kommentar — dieser Test belegt nur, dass
    // das Tokenisieren selbst kein Fenster braucht, um schnell zu bleiben).
    expect(elapsedMs).toBeLessThan(200);
  });
});
