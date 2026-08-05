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
/** Was das Backend als Unterverzeichnisse meldet, je Verzeichnisteil. */
let subdirectories: Record<string, string[]>;
/** Steht die Antwort des Backends noch aus? */
let listPending: boolean;
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
  subdirectories = {};
  listPending = false;
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
    listSubdirectories: (_cwd, directory, prefix) =>
      listPending
        ? undefined
        : (subdirectories[directory] ?? []).filter((name) =>
            name.toLowerCase().startsWith(prefix.toLowerCase()),
          ),
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

describe("Verzeichnis-Popup bei cd", () => {
  const items = () =>
    [...document.querySelectorAll(".pc-cdpopup__item")].map(
      (element) => element.textContent,
    );
  const selected = () =>
    document.querySelector(".pc-cdpopup__item--selected")?.textContent ?? null;

  it("benennt beide Tasten, nicht nur die richtige", async () => {
    // Tab ist nicht die Taste, die man vor einer Liste erwartet; ohne den
    // Hinweis probiert man Enter und bekommt seinen Befehl ausgeführt.
    subdirectories = { "": ["src"] };

    await type("cd ");

    const footer = document.querySelector(".pc-cdpopup__footer");
    expect(
      [...(footer?.querySelectorAll("kbd") ?? [])].map(
        (element) => element.textContent,
      ),
    ).toEqual(["Tab", "Enter"]);
    expect(footer?.textContent).toContain("übernehmen");
    expect(footer?.textContent).toContain("abschicken");
  });

  it("zeigt die tatsächlichen Unterverzeichnisse, nicht die History", async () => {
    // In der History steht `cd apps` — hier gibt es das gar nicht.
    subdirectories = { "": ["docs", "src"] };

    await type("cd ");

    expect(items()).toEqual(["docs", "src"]);
    expect(selected()).toBe("docs");
  });

  it("filtert nach dem bereits getippten Präfix", async () => {
    subdirectories = { "": ["docs", "src", "scripts"] };

    await type("cd sr");

    expect(items()).toEqual(["src"]);
  });

  it("listet die nächste Ebene eines verschachtelten Pfades", async () => {
    subdirectories = { "": ["src"], "src/": ["terminal", "test"] };

    await type("cd src/te");

    expect(items()).toEqual(["terminal", "test"]);
  });

  it("zeigt gar nichts, wenn nichts passt", async () => {
    subdirectories = { "": ["docs"] };

    await type("cd zz");

    // Kein leerer Rahmen: ohne Treffer gibt es kein Popup.
    expect(document.querySelector(".pc-cdpopup")).toBeNull();
    expect(suggestion.directories.visible()).toBe(false);
  });

  it("bewegt die Auswahl mit den Pfeiltasten", async () => {
    // Sortiert wie das Backend liefert.
    subdirectories = { "": ["docs", "scripts", "src"] };
    await type("cd ");

    suggestion.directories.move(1);
    await settle();
    expect(selected()).toBe("scripts");

    // Am oberen Ende bleibt die Auswahl stehen, statt umzulaufen.
    suggestion.directories.move(-5);
    await settle();
    expect(selected()).toBe("docs");
  });

  it("übernimmt den Eintrag samt Schrägstrich und bietet die nächste Ebene an", async () => {
    subdirectories = { "": ["src"], "src/": ["terminal"] };
    await type("cd sr");

    expect(suggestion.directories.accept()).toBe(true);
    // Nur der fehlende Rest wird geschrieben, plus der `/` für die nächste
    // Ebene — geschrieben über denselben Pfad wie eine echte Eingabe.
    expect(sent).toEqual(["c/"]);

    await settle();
    expect(items()).toEqual(["terminal"]);
  });

  it("bleibt nach dem Übernehmen stehen, nimmt aber nichts zweites an", async () => {
    // Die Lücke, in der der gemeldete Fehler entstand: verschwände die Liste
    // hier bis zum Echo der Shell, fiele ein Escape in dieser Zeit an ihr
    // vorbei in die Shell — wo es als Meta-Präfix das nächste Enter umdeutet.
    subdirectories = { "": ["src"], "src/": ["terminal"] };
    await type("cd sr");

    listPending = true;
    expect(suggestion.directories.accept()).toBe(true);
    expect(suggestion.directories.visible()).toBe(true);
    // Ein schnelles zweites Tab darf denselben Eintrag nicht nochmal
    // einfügen — es gehört dann der Tab-Completion der Shell.
    expect(suggestion.directories.accept()).toBe(false);
    expect(sent).toEqual(["c/"]);

    listPending = false;
    suggestion.refresh();
    await settle();
    expect(items()).toEqual(["terminal"]);
  });

  it("schreibt bei abweichender Schreibweise den echten Namen", async () => {
    // Auf einem case-insensitiven Dateisystem erreicht `cd sr` auch `Src`;
    // dann darf nicht `srSrc` entstehen.
    subdirectories = { "": ["Src"] };
    await type("cd sr");

    expect(suggestion.directories.accept()).toBe(true);
    expect(sent).toEqual(["\x7f\x7fSrc/"]);
  });

  it("verwirft mit Escape, ohne die Eingabezeile anzufassen", async () => {
    subdirectories = { "": ["docs", "src"] };
    await type("cd ");

    suggestion.directories.dismiss();
    await settle();

    expect(document.querySelector(".pc-cdpopup")).toBeNull();
    expect(sent).toEqual([]);
    // Unsichtbar heißt: auch Tab gehört wieder der Shell.
    expect(suggestion.directories.visible()).toBe(false);

    // Verworfen ist nur DIESE Eingabe; das nächste Zeichen fragt neu.
    await type("s");
    expect(items()).toEqual(["src"]);
  });

  it("bleibt weg, wenn die Shell die Zeile nach dem Escape noch verändert", async () => {
    // Der Fall, an dem eine textgebundene Regel scheitert: eine übernommene
    // Ergänzung spiegelt die Shell erst Millisekunden später zurück. Zählte
    // die Eingabezeile, käme die Liste durch dieses Echo von selbst zurück —
    // direkt nachdem der Nutzer gesagt hat, dass er sie nicht will.
    subdirectories = { "": ["src"], "src/": ["terminal"] };
    await type("cd s");
    expect(items()).toEqual(["src"]);

    suggestion.directories.dismiss();
    await write("rc/");
    await settle();

    expect(document.querySelector(".pc-cdpopup")).toBeNull();

    // Erst der nächste Tastendruck holt sie zurück.
    await type("t");
    expect(items()).toEqual(["terminal"]);
  });

  it("vergisst das Verwerfen, sobald sich die Eingabe ändert", async () => {
    subdirectories = { "": ["scripts", "src"] };
    await type("cd sr");
    suggestion.directories.dismiss();
    await settle();
    expect(document.querySelector(".pc-cdpopup")).toBeNull();

    // Backspace, dann dasselbe Zeichen wieder: die Liste gehört zur Eingabe,
    // nicht zu einer Entscheidung, an die sich niemand mehr erinnert.
    terminal.input("\x7f", true);
    await write("\b \b");
    await settle();
    expect(items()).toEqual(["scripts", "src"]);

    await type("r");
    expect(items()).toEqual(["src"]);
  });

  it("verschwindet im Alternate Screen", async () => {
    subdirectories = { "": ["docs"] };
    await type("cd ");
    expect(items()).toEqual(["docs"]);

    await write("\x1b[?1049h");
    await settle();

    expect(document.querySelector(".pc-cdpopup")).toBeNull();
  });

  it("hält die stehende Liste, während die nächste Abfrage läuft", async () => {
    // Sonst blinkte sie bei jedem Zeichen weg — und ein Escape in dieser
    // Lücke ginge an der Shell statt an der Liste.
    subdirectories = { "": ["scripts", "src"] };
    await type("cd s");
    expect(items()).toEqual(["scripts", "src"]);

    listPending = true;
    await type("r");
    expect(items()).toEqual(["scripts", "src"]);
    expect(suggestion.directories.visible()).toBe(true);

    listPending = false;
    suggestion.refresh();
    await settle();
    expect(items()).toEqual(["src"]);
  });

  it("übernimmt auch aus einer noch nicht aktualisierten Liste das Richtige", async () => {
    subdirectories = { "": ["src"] };
    await type("cd s");

    listPending = true;
    await type("x");

    // „src" passt nicht mehr zu „sx" — die falschen Zeichen werden per
    // Backspace zurückgenommen, statt sie zu verlängern.
    expect(suggestion.directories.accept()).toBe(true);
    expect(sent).toEqual(["\x7f\x7fsrc/"]);
  });

  it("zeigt erst, wenn die erste Abfrage beantwortet ist", async () => {
    subdirectories = { "": ["docs", "src"] };
    listPending = true;

    await type("cd ");
    expect(document.querySelector(".pc-cdpopup")).toBeNull();

    listPending = false;
    suggestion.refresh();
    await settle();

    expect(items()).toEqual(["docs", "src"]);
  });
});
