import { describe, expect, it } from "vitest";
import type { GhostInput } from "./suggestion";
import { classifyKeystroke, computeGhost, rememberCommand } from "./suggestion";

// Ein 40 Zellen breiter Bildschirm mit Prompt und Eingabe, wie xterm ihn
// zurückgibt: rechts mit Leerzellen aufgefüllt, nicht abgeschnitten.
const PROMPT = "~/panecrew ❯ ";
const row = (input: string, tail = "") =>
  (PROMPT + input + tail).padEnd(40, " ");

// Ein Dateisystem, in dem genau die aufgezählten Verzeichnisse existieren.
// `pending` steht für "Prüfung läuft noch" — der Zustand direkt nach dem
// ersten Tastendruck, bevor das Backend geantwortet hat.
const filesystem =
  (dirs: readonly string[], pending: readonly string[] = []) =>
  (_cwd: string, path: string) =>
    pending.includes(path) ? undefined : dirs.includes(path);

const ghostOf = (input: string, overrides: Partial<GhostInput> = {}) =>
  computeGhost({
    bufferType: "normal",
    anchor: { x: PROMPT.length, y: 7 },
    cursor: { x: PROMPT.length + input.length, y: 7 },
    rowText: row(input),
    history: ["pnpm tauri dev", "pnpm test", "git status"],
    cwd: "/Users/dev/panecrew",
    isDirectory: filesystem([]),
    ...overrides,
  });

describe("classifyKeystroke", () => {
  it("meldet den Zeilenumbruch als Abschicken", () => {
    expect(classifyKeystroke("\r")).toBe("submit");
    expect(classifyKeystroke("\n")).toBe("submit");
    // Ein eingefügter mehrzeiliger Block schickt ebenfalls ab.
    expect(classifyKeystroke("ls\r")).toBe("submit");
  });

  it("meldet Ctrl+C und Ctrl+D als Verwerfen", () => {
    expect(classifyKeystroke("\x03")).toBe("abort");
    expect(classifyKeystroke("\x04")).toBe("abort");
  });

  it("setzt den Anker bei druckbarer Eingabe und bei Escape-Sequenzen", () => {
    expect(classifyKeystroke("g")).toBe("arm");
    expect(classifyKeystroke("ä")).toBe("arm");
    // Pfeil hoch: die Shell holt einen History-Eintrag in dieselbe Zeile, der
    // Ankerpunkt gilt danach genauso.
    expect(classifyKeystroke("\x1b[A")).toBe("arm");
  });

  it("lässt den Anker bei Bearbeitungstasten unangetastet", () => {
    // Backspace, Tab (Shell-Completion), Ctrl+U, Ctrl+R — was sie am Text
    // ändern, steht danach auf dem Bildschirm und wird von dort gelesen.
    expect(classifyKeystroke("\x7f")).toBe("keep");
    expect(classifyKeystroke("\t")).toBe("keep");
    expect(classifyKeystroke("\x15")).toBe("keep");
    expect(classifyKeystroke("\x12")).toBe("keep");
  });
});

describe("computeGhost", () => {
  it("ergänzt den Rest des jüngsten passenden Befehls", () => {
    expect(ghostOf("pnpm t")).toBe("auri dev");
  });

  it("zeigt nichts im Alternate-Screen-Puffer", () => {
    // Das Gate für Vollbild-Programme: vim, Claude Code und jedes andere
    // Ink-TUI malen hier ihre eigene Eingabezeile.
    expect(ghostOf("pnpm t", { bufferType: "alternate" })).toBe("");
  });

  it("zeigt nichts ohne Anker", () => {
    expect(ghostOf("pnpm t", { anchor: null })).toBe("");
  });

  it("zeigt nichts, wenn der Cursor die Ankerzeile verlassen hat", () => {
    expect(ghostOf("pnpm t", { cursor: { x: 19, y: 8 } })).toBe("");
  });

  it("zeigt nichts bei leerer Eingabe", () => {
    expect(ghostOf("")).toBe("");
    expect(ghostOf("   ")).toBe("");
  });

  it("zeigt nichts, wenn die Eingabe den Treffer schon vollständig ist", () => {
    expect(ghostOf("pnpm test")).toBe("");
  });

  it("überspringt mehrzeilige History-Einträge", () => {
    const ghost = ghostOf("for f", {
      history: ["for f in *; do\necho $f\ndone"],
    });

    expect(ghost).toBe("");
  });

  it("kürzt auf die freien Zellen hinter dem Cursor", () => {
    // Ein rechtsbündiges Prompt (zsh RPROMPT) oder eine Ergänzung eines
    // Shell-Plugins darf nicht überschrieben werden.
    const ghost = ghostOf("pnpm t", {
      rowText: row("pnpm t", "   main ✱"),
    });

    expect(ghost).toBe("aur");
  });

  it("zeigt nichts, wenn direkt hinter dem Cursor Text steht", () => {
    const ghost = ghostOf("pnpm t", { rowText: row("pnpm t", "x") });

    expect(ghost).toBe("");
  });

  it("liest die Eingabe vom Bildschirm, nicht aus den Tastendrücken", () => {
    // Nach einer Tab-Completion der Shell steht mehr auf dem Schirm, als
    // getippt wurde — der Vorschlag muss auf diesem Text aufbauen.
    const ghost = computeGhost({
      bufferType: "normal",
      anchor: { x: PROMPT.length, y: 7 },
      cursor: { x: PROMPT.length + "pnpm ta".length, y: 7 },
      rowText: row("pnpm ta"),
      history: ["pnpm tauri dev"],
      cwd: "/Users/dev/panecrew",
      isDirectory: filesystem([]),
    });

    expect(ghost).toBe("uri dev");
  });
});

describe("computeGhost bei cd", () => {
  // Der vom Nutzer gefundene Fehler: `cd Desktop` stand in der History, weil
  // es irgendwo einmal getippt wurde. History-Dateien speichern kein
  // Arbeitsverzeichnis, also wurde es auch dort vorgeschlagen, wo es kein
  // `Desktop` gibt — angenommen ergab das ein „no such file or directory".
  it("schlägt kein Verzeichnis vor, das es hier nicht gibt", () => {
    const ghost = ghostOf("cd ", {
      history: ["cd Desktop"],
      isDirectory: filesystem(["apps", "docs"]),
    });

    expect(ghost).toBe("");
  });

  it("schlägt ein Verzeichnis vor, das es hier gibt", () => {
    const ghost = ghostOf("cd ", {
      history: ["cd apps"],
      isDirectory: filesystem(["apps"]),
    });

    expect(ghost).toBe("apps");
  });

  it("überspringt den unmöglichen Treffer und nimmt den nächsten möglichen", () => {
    // Der eigentliche Alltagsfall: der jüngste Eintrag passt textlich, aber
    // nur der ältere existiert hier wirklich.
    const ghost = ghostOf("cd ", {
      history: ["cd Desktop", "cd docs"],
      isDirectory: filesystem(["docs"]),
    });

    expect(ghost).toBe("docs");
  });

  it("zeigt nichts, solange die Prüfung noch läuft", () => {
    const ghost = ghostOf("cd ", {
      history: ["cd apps"],
      isDirectory: filesystem(["apps"], ["apps"]),
    });

    expect(ghost).toBe("");
  });

  it("wartet auf den vorderen Kandidaten, statt den hinteren vorzuziehen", () => {
    // Sonst erschiene erst „docs" und würde einen Frame später gegen „apps"
    // ausgetauscht — ein Flackern genau unter dem Cursor.
    const ghost = ghostOf("cd ", {
      history: ["cd apps", "cd docs"],
      isDirectory: filesystem(["apps", "docs"], ["apps"]),
    });

    expect(ghost).toBe("");
  });

  it("schlägt ohne bekanntes Arbeitsverzeichnis gar kein cd vor", () => {
    // Shells ohne PaneCrews Wrapper (fish, cmd.exe) melden keins. Raten wäre
    // genau der Fehler, um den es hier geht.
    const ghost = ghostOf("cd ", {
      history: ["cd apps"],
      cwd: null,
      isDirectory: filesystem(["apps"]),
    });

    expect(ghost).toBe("");
  });

  it("prüft das Ziel, nicht den Rest der Befehlszeile", () => {
    const ghost = ghostOf("cd ap", {
      history: ["cd apps && pnpm test"],
      isDirectory: filesystem(["apps"]),
    });

    expect(ghost).toBe("ps && pnpm test");
  });

  it("liest ein Ziel mit Leerzeichen aus den Anführungszeichen", () => {
    const ghost = ghostOf("cd ", {
      history: ['cd "My Notes"'],
      isDirectory: filesystem(["My Notes"]),
    });

    expect(ghost).toBe('"My Notes"');
  });

  it("prüft nichts bei `cd` ohne Ziel — das Home-Verzeichnis gibt es immer", () => {
    const ghost = ghostOf("cd", {
      history: ["cd -"],
      isDirectory: filesystem([]),
    });

    // `cd -` ist kein prüfbarer Pfad und entfällt deshalb …
    expect(ghost).toBe("");
    // … `cd` allein dagegen ist ein ganz normaler Befehl.
    expect(
      ghostOf("c", { history: ["cd"], isDirectory: filesystem([]) }),
    ).toBe("d");
  });

  it("lässt jeden anderen Befehl ungeprüft durch", () => {
    // Nur `cd` bekommt diese Behandlung; für alles andere hat PaneCrew keine
    // Shell-Grammatik und maßt sich auch keine an.
    const ghost = ghostOf("code", {
      history: ["code Desktop"],
      isDirectory: filesystem([]),
    });

    expect(ghost).toBe(" Desktop");
  });

  it("begrenzt die Anzahl der Prüfungen pro Durchgang", () => {
    const probed: string[] = [];
    const history = Array.from({ length: 40 }, (_, index) => `cd dir${index}`);

    ghostOf("cd ", {
      history,
      isDirectory: (_cwd, path) => {
        probed.push(path);
        return false;
      },
    });

    expect(probed).toHaveLength(12);
  });
});

describe("rememberCommand", () => {
  it("stellt den Befehl nach vorn und entfernt das ältere Vorkommen", () => {
    expect(rememberCommand(["ls", "git status", "ls -la"], "git status")).toEqual(
      ["git status", "ls", "ls -la"],
    );
  });

  it("begrenzt die Liste", () => {
    expect(rememberCommand(["a", "b", "c"], "d", 2)).toEqual(["d", "a"]);
  });
});
