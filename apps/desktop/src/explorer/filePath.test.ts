import { describe, expect, it } from "vitest";
import { isPathOrDescendant, remapRenamedPath } from "./filePath";

describe("isPathOrDescendant", () => {
  it("ist wahr, wenn der Pfad exakt der Vorfahre selbst ist", () => {
    expect(isPathOrDescendant("src", "src")).toBe(true);
  });

  it("ist wahr für einen Pfad direkt unter dem Vorfahren", () => {
    expect(isPathOrDescendant("src/App.tsx", "src")).toBe(true);
  });

  it("ist wahr für einen tiefer verschachtelten Pfad", () => {
    expect(isPathOrDescendant("src/explorer/filePath.ts", "src")).toBe(true);
  });

  it("ist falsch für einen unbeteiligten Pfad", () => {
    expect(isPathOrDescendant("docs/README.md", "src")).toBe(false);
  });

  it("verwechselt kein Präfix mit einem Vorfahren (src2 ist kein Kind von src)", () => {
    expect(isPathOrDescendant("src2/App.tsx", "src")).toBe(false);
  });
});

describe("remapRenamedPath", () => {
  it("ersetzt den Pfad, wenn er exakt der umbenannte Eintrag ist", () => {
    expect(remapRenamedPath("a.txt", "a.txt", "b.txt")).toBe("b.txt");
  });

  it("rechnet einen Pfad UNTER einem umbenannten Ordner auf den neuen Namen um", () => {
    expect(remapRenamedPath("src/old/App.tsx", "src/old", "src/new")).toBe(
      "src/new/App.tsx",
    );
  });

  it("lässt einen unbeteiligten Pfad unverändert", () => {
    expect(remapRenamedPath("docs/README.md", "src", "lib")).toBe("docs/README.md");
  });

  it("verwechselt kein Präfix mit dem umbenannten Ordner (src2 ist kein Kind von src)", () => {
    expect(remapRenamedPath("src2/App.tsx", "src", "lib")).toBe("src2/App.tsx");
  });
});
