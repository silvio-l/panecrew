import { Terminal } from "@xterm/xterm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachInlineSuggestion } from "./inlineSuggestion";
import type { InlineSuggestion } from "./inlineSuggestion";

// Integrationstest gegen das ECHTE xterm.js, nicht gegen eine Attrappe: die
// Punkte, an denen dieses Feature realistisch bricht, liegen alle in xterms
// eigenem Zustand — wann `buffer.active.type` umschlägt, was in der
// Cursorzeile wirklich steht, ob ein Decoration-Element entsteht. Eine
// nachgebaute Terminal-Klasse würde genau diese Fragen wegdefinieren.
//
// jsdom misst keine Zellen (getBoundingClientRect liefert überall 0), das
// Zellraster ist hier also nicht echt. Für die geprüften Aussagen spielt das
// keine Rolle — sie hängen an Puffer- und DOM-Zustand, nicht an Pixeln.

// xterm fragt beim Öffnen das Device-Pixel-Ratio über eine Media Query ab;
// jsdom hat matchMedia nicht. Nur hier gesetzt, nicht im globalen Setup: es
// ist eine Anforderung genau dieses Tests, nicht der App.
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

const PROMPT = "~/panecrew ❯ ";
const HISTORY = ["pnpm tauri dev", "pnpm test", "git status --short", "cd apps"];

let terminal: Terminal;
let suggestion: InlineSuggestion;
let sent: string[];
/** Verzeichnisse, die es im Arbeitsverzeichnis der Pane gibt. */
let directories: string[];
/** Ziele, deren Prüfung noch läuft — zu lösen über `resolveProbes()`. */
let unresolved: string[];

function resolveProbes(): void {
  unresolved = [];
  suggestion.refresh();
}

const settle = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });

const write = (text: string) =>
  new Promise<void>((resolve) => {
    terminal.write(text, resolve);
  });

/** Ein Tastendruck in der Reihenfolge einer echten PTY: erst onData, dann das Echo. */
async function type(text: string): Promise<void> {
  terminal.input(text, true);
  await write(text === "\r" ? `\r\n${PROMPT}` : text);
  await settle();
}

const ghostText = () =>
  [...document.querySelectorAll(".xterm-decoration-container div")]
    .map((element) => element.textContent)
    .join("");

beforeEach(async () => {
  const container = document.createElement("div");
  document.body.append(container);
  // allowProposedApi wie in usePtyTerminal.ts — ohne das Flag wirft xterm
  // beim Registrieren von Marker und Decoration.
  terminal = new Terminal({ cols: 60, rows: 10, allowProposedApi: true });
  terminal.open(container);
  sent = [];
  directories = [];
  unresolved = [];
  suggestion = attachInlineSuggestion(terminal, {
    write: (text) => {
      sent.push(text);
      // Die Shell spiegelt Eingaben zurück; hier von Hand.
      terminal.write(text);
    },
    baseHistory: () => HISTORY,
    cwd: () => "/Users/dev/panecrew",
    isDirectory: (_cwd, path) =>
      unresolved.includes(path) ? undefined : directories.includes(path),
    font: { fontFamily: "monospace", fontSize: 13 },
  });
  await write(PROMPT);
  await settle();
});

afterEach(() => {
  suggestion.dispose();
  terminal.dispose();
  document.body.replaceChildren();
});

describe("attachInlineSuggestion", () => {
  it("zeigt den Rest des passenden Befehls hinter dem Cursor", async () => {
    await type("pnpm ta");

    expect(ghostText()).toBe("uri dev");
  });

  it("malt in der Terminalschrift und im eigenen gedimmten Token", async () => {
    await type("pnpm ta");
    const element = document.querySelector<HTMLElement>(
      ".xterm-decoration-container div",
    );

    // Weder der Fokus-Akzent (laut Direction Contract exklusiv für die
    // Fokus-Mechanik) noch eine ANSI-Farbe, die im Terminalinhalt feste
    // Bedeutung hat.
    expect(element?.style.color).toBe("var(--pc-terminal-ghostForeground)");
    // Die Zelltypografie steht nicht im Decoration-Container; ohne diese
    // Angaben säße der Text in der UI-Schrift des Chromes.
    expect(element?.style.fontFamily).toBe("monospace");
    expect(element?.style.fontSize).toBe("13px");
  });

  it("übernimmt die Ergänzung über denselben Schreibpfad wie eine Eingabe", async () => {
    await type("pnpm ta");

    expect(suggestion.accept()).toBe(true);
    expect(sent).toEqual(["uri dev"]);

    await settle();
    // Danach steht der volle Befehl da und es gibt nichts mehr zu ergänzen.
    expect(ghostText()).toBe("");
  });

  it("meldet nichts zu übernehmen, wenn keine Ergänzung sichtbar ist", async () => {
    await type("xyz");

    expect(ghostText()).toBe("");
    expect(suggestion.accept()).toBe(false);
    expect(sent).toEqual([]);
  });

  it("verschwindet im Alternate Screen und kommt sauber zurück", async () => {
    await type("pnpm ta");
    expect(ghostText()).toBe("uri dev");

    // DECSET 1049 — der Umschalter, den vim und jedes Ink-basierte CLI-Tool
    // (Claude Code) benutzen.
    await write("\x1b[?1049h");
    await settle();
    expect(terminal.buffer.active.type).toBe("alternate");
    expect(ghostText()).toBe("");

    // Das TUI malt seine eigene Eingabezeile — auch die darf nichts auslösen.
    await write("\x1b[H> pnpm ta");
    await settle();
    expect(ghostText()).toBe("");

    // Zurück zum normalen Puffer. Der alte Anker darf nicht wiederaufleben:
    // die halb getippte Zeile von vorhin steht zwar noch im Puffer, gehört
    // aber zu einem Prompt, den es nicht mehr gibt.
    await write("\x1b[?1049l");
    await settle();
    expect(ghostText()).toBe("");

    // Wie eine echte Shell nach dem Beenden von vim: neuer Prompt, neue
    // Eingabe — und die Ergänzung ist wieder da.
    await write(`\r\n${PROMPT}`);
    await type("pnpm ta");
    expect(ghostText()).toBe("uri dev");
  });

  it("räumt die Ergänzung beim Abschicken weg", async () => {
    await type("pnpm ta");

    await type("\r");

    expect(ghostText()).toBe("");
  });

  it("stellt in dieser Pane getippte Befehle vor die Datei-History", async () => {
    // "pnpm t" träfe aus der Datei-History "pnpm tauri dev". Was hier lief,
    // zählt mehr.
    await type("pnpm typecheck");
    await type("\r");
    await type("pnpm t");

    expect(ghostText()).toBe("ypecheck");
  });

  it("übernimmt eine Tab-Completion der Shell, statt gegen sie zu laufen", async () => {
    await type("pnpm ");
    // Die Shell ergänzt selbst — für uns nur Ausgabe, kein Tastendruck.
    terminal.input("\t", true);
    await write("ta");
    await settle();

    expect(ghostText()).toBe("uri dev");
  });

  it("verwirft das Tracking nach reset()", async () => {
    await type("pnpm ta");

    suggestion.reset();

    expect(ghostText()).toBe("");
  });

  it("zeigt den cd-Vorschlag erst, wenn das Verzeichnis bestätigt ist", async () => {
    directories = ["apps"];
    unresolved = ["apps"];

    await type("cd ap");
    // Solange die Prüfung läuft, steht dort nichts — auch nicht kurz.
    expect(ghostText()).toBe("");

    resolveProbes();
    await settle();

    expect(ghostText()).toBe("ps");
  });
});
