import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Tooltip } from "radix-ui";
import { invoke } from "@tauri-apps/api/core";
import { ExplorerPanel } from "./ExplorerPanel";
import { resetSettingsStoreForTests } from "../settings/settingsStore";
import type { GitDecorations } from "../types/gitStatus";
import type { Project, TreeNode } from "../types/project";

// Dasselbe Muster wie About.test.tsx: ein einzelner, überall erfolgreich
// auflösender Mock reicht, weil kein Test hier auf einen konkreten
// Rückgabewert angewiesen ist — geprüft wird jeweils NUR, mit welchen
// Argumenten `invoke` aufgerufen wurde.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
// ExplorerPanel hängt seit Ticket 05 über `useSettings` am
// `settings:changed`-Live-Reload — ohne Mock griffe der echte Tauri
// `listen()` nach internem Bridge-Zustand, den es unter jsdom nicht gibt.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(() => Promise.resolve()),
}));
// VS Code selbst ist nicht Gegenstand dieser Tests — ohne diesen Mock riefe brandlint-ok: funktionaler Test-Mock für reale Editor-Erkennung
// `vscodeIsInstalled()` denselben `invoke`-Mock auf und das Kontextmenü
// bekäme abhängig von der Testreihenfolge mal den Eintrag "In VS Code brandlint-ok: funktionaler UI-Text im Testkommentar
// öffnen", mal nicht.
vi.mock("../explorer/vscodeDetection", () => ({
  vscodeIsInstalled: () => Promise.resolve(false),
}));

// Die Virtualisierung des Dateibaums. Bewusst direkt an `ExplorerPanel` und
// nicht über `App` wie der Rest der Explorer-Tests: hier soll ein Baum mit
// tausenden Knoten stehen, und der ist über den echten Öffnen-Weg samt
// IPC-Attrappen weder nötig noch lesbar.
//
// Höhe hat das Sichtfenster nur, weil src/test/setup.ts sie dem Element mit
// `data-virtual-viewport` unterschiebt — jsdom rechnet kein Layout. Alle
// Zahlen unten hängen daran: 400px Sichtfenster, 22px Zeilenhöhe (ROW_HEIGHT
// bzw. --pc-list-rowHeight), also rund 18 sichtbare Zeilen plus je 10 Zeilen
// Puffer über und unter dem Fenster.
const VIEWPORT_ROWS = Math.ceil(400 / 22);
const OVERSCAN = 10;
const ROW_HEIGHT = 22;

const project = (
  tree: TreeNode[],
  gitDecorations: GitDecorations,
): Project => ({
  path: "/Users/dev/projects/storefront",
  name: "storefront",
  tree,
  treeError: null,
  gitDecorations,
});

const renderPanel = (
  tree: TreeNode[],
  gitDecorations: GitDecorations = new Map(),
) =>
  render(
    <Tooltip.Provider>
      <ExplorerPanel
        project={project(tree, gitDecorations)}
        width={224}
        selectedFile=""
        dirtyFile={null}
        onExpandedChange={() => undefined}
        onSelectFile={() => undefined}
        onCollapse={() => undefined}
        onRefresh={() => undefined}
        onLoadChildren={() => Promise.resolve()}
        onStartPathDrag={() => undefined}
        draggingPath={null}
        onConsumeDragClick={() => false}
        onEntryRenamed={() => undefined}
        onEntryDeleted={() => undefined}
      />
    </Tooltip.Provider>,
  );

/** Die gemounteten Baumzeilen in ihrer DOM-Reihenfolge. `data-row-index` trägt
 * nur die Baumzeile, nicht die Kopfzeilen-Knöpfe daneben. */
const mountedRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-row-index]"));

const flatTree = (count: number): TreeNode[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `datei-${String(index).padStart(4, "0")}.ts`,
    isDirectory: false as const,
    kind: "ts" as const,
  }));

describe("ExplorerPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Ticket 08: `useSettings` holt seine Werte jetzt über den geteilten
    // `settingsStore.ts` — dessen Zwischenstand ist modulweit und würde ohne
    // Reset unbemerkt aus einem Test in den nächsten durchsickern (der Test
    // unten mit `explorer.confirmBeforeDelete: false` erwartet z. B. einen
    // frischen Fetch mit genau diesem, vom Standard-Mock abweichenden Wert).
    resetSettingsStoreForTests();
  });

  it("mountet auch bei 5000 Knoten nur den sichtbaren Ausschnitt", () => {
    renderPanel(flatTree(5000));

    const rows = mountedRows();
    // Die Aussage ist die Schranke, nicht die genaue Zahl: gemountet wird das
    // Sichtfenster plus Puffer, nie der ganze Baum. Vor der Virtualisierung
    // standen hier 5000 Zeilen im DOM — der Grund, aus dem jeder Pane-Wechsel
    // (der das Panel per `key` neu aufbaut) spürbar hing.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(VIEWPORT_ROWS + 2 * OVERSCAN + 2);
    expect(rows[0]).toHaveAttribute("data-row-index", "0");
    expect(screen.getByText("datei-0000.ts")).toBeInTheDocument();
    // Was hinten aus dem Fenster fällt, ist wirklich nicht da — sonst wäre
    // oben nur die Schranke zufällig eingehalten.
    expect(screen.queryByText("datei-4999.ts")).not.toBeInTheDocument();
  });

  it("hält die Bildlaufleiste ehrlich: der Platzhalter trägt die Höhe aller Zeilen", () => {
    const { container } = renderPanel(flatTree(5000));

    // Ohne diesen Platzhalter zeigte die Leiste die Länge des gemounteten
    // Ausschnitts statt die des Baums — man könnte nicht bis zum Ende scrollen.
    const sizer = container.querySelector<HTMLElement>(
      "[data-virtual-viewport] > div",
    );
    expect(sizer).toHaveStyle({ height: `${String(5000 * ROW_HEIGHT)}px` });
  });

  it("startet mit eingeklappten Ordnern und klappt sie erst per Klick auf", () => {
    renderPanel([
      {
        name: "src",
        isDirectory: true,
        children: [
          { name: "main.rs", isDirectory: false },
          { name: "lib.rs", isDirectory: false },
        ],
      },
      { name: "README.md", isDirectory: false, kind: "md" },
    ]);
    // Standard seit 2026-08-12: alle Ordner starten eingeklappt, nur die
    // Wurzelkinder sind sichtbar — vorher war das Set beim ersten Mount leer,
    // ein neu geöffnetes Projekt zeigte also sofort den ganzen Baum.
    expect(mountedRows()).toHaveLength(2);
    expect(screen.queryByText("main.rs")).not.toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "src" }));

    // Der Ordner bleibt stehen, seine Kinder erscheinen darunter.
    expect(mountedRows()).toHaveLength(4);
    expect(screen.getByText("main.rs")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    expect(mountedRows()).toHaveLength(2);
  });

  it("findet die Git-Deko auch für tief liegende Zeilen unter ihrem zusammengesetzten Pfad", () => {
    // Der Prüfgegenstand ist die Pfad-Konvention des Ausrollens (Tiefe 0: der
    // bloße Name, darunter `${eltern}/${name}`). Sie ist zugleich der
    // Schlüssel von `gitDecorations`, `collapsed` und `selectedFile` — liefe
    // sie auseinander, fiele die Deko still aus, ohne dass ein Typ meckert.
    renderPanel(
      [
        {
          name: "src",
          isDirectory: true,
          children: [
            {
              name: "core",
              isDirectory: true,
              children: [{ name: "main.rs", isDirectory: false, kind: "rs" }],
            },
          ],
        },
      ],
      new Map([
        ["src", "modified"],
        ["src/core", "modified"],
        ["src/core/main.rs", "modified"],
      ]),
    );
    // Standardmäßig eingeklappt (2026-08-12) — erst beide Ebenen aufklappen,
    // damit `main.rs` überhaupt eine Zeile bekommt.
    fireEvent.click(screen.getByRole("button", { name: /^src,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^core,/ }));

    expect(
      screen.getByRole("button", { name: /main\.rs,\s*geändert/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /core,\s*enthält geänderte Dateien/,
      }),
    ).toBeInTheDocument();
  });

  it("zählt im Fußzeilen-Readout sichtbare gegen vorhandene Einträge", () => {
    renderPanel([
      {
        name: "src",
        isDirectory: true,
        children: [
          { name: "main.rs", isDirectory: false },
          { name: "lib.rs", isDirectory: false },
        ],
      },
      { name: "README.md", isDirectory: false, kind: "md" },
    ]);
    // 4 Knoten insgesamt, sichtbar anfangs nur die 2 Wurzelkinder (Ordner
    // starten eingeklappt). Geprüft wird der Screenreader-Satz statt des
    // sichtbaren "2/4": Letzteres ist als reines Ziffernpaar bewusst nicht
    // übersetzt, der Satz dagegen trägt beide Zahlen UND die Bedeutung.
    expect(
      screen.getByText("2 von 4 Einträgen sichtbar"),
    ).toBeInTheDocument();

    // Das Readout ist ein Instrument, kein Standbild: Aufklappen hebt die
    // sichtbare Zahl, die Bezugsgröße bleibt.
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    expect(
      screen.getByText("4 von 4 Einträgen sichtbar"),
    ).toBeInTheDocument();
  });

  it("wandert mit den Pfeiltasten auf die benachbarte Zeile", () => {
    renderPanel(flatTree(5000));

    const first = screen.getByRole("button", { name: "datei-0000.ts" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "datei-0001.ts" })).toHaveFocus();

    fireEvent.keyDown(document.activeElement ?? first, { key: "ArrowUp" });
    expect(first).toHaveFocus();
  });

  it("bleibt an den Enden der Liste stehen", () => {
    renderPanel(flatTree(3));

    const first = screen.getByRole("button", { name: "datei-0000.ts" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(first).toHaveFocus();

    const last = screen.getByRole("button", { name: "datei-0002.ts" });
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(last).toHaveFocus();
  });

  it("holt eine nicht gemountete Zeile erst ins Sichtfenster, bevor sie den Fokus bekommt", () => {
    // Geprüft ist hier nur das erste Glied der Kette: dass die Pfeiltaste am
    // Rand des gemounteten Fensters überhaupt einen Bildlauf ANFORDERT, statt
    // ins Leere zu greifen. Weiter kommt jsdom nicht — ohne Layout ist auch
    // `scrollHeight`/`clientHeight` 0, der Virtualizer begrenzt sein Ziel
    // damit auf 0, es entsteht kein scroll-Ereignis, kein neues Sichtfenster
    // und folglich auch keine Zeile, die den Fokus übernehmen könnte. Der
    // Sprung über die Fenstergrenze ist deshalb nur im laufenden Programm
    // vollständig nachweisbar; hier wäre jede Zahl eine erfundene.
    const scrollTo = vi.fn();
    // jsdom bringt für Element gar kein scrollTo mit; der Virtualizer ruft es
    // optional auf und täte hier sonst unbemerkt nichts. Weil es nichts zu
    // ersetzen gibt, ist das kein vi.spyOn — `vi.restoreAllMocks()` räumt das
    // hier also nicht mit weg, das muss der Test selbst tun. Sonst erbte jeder
    // künftig darunter angehängte Test diese Attrappe samt ihrer Aufrufe.
    Object.defineProperty(Element.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollTo,
    });
    onTestFinished(() => {
      Reflect.deleteProperty(Element.prototype, "scrollTo");
    });
    renderPanel(flatTree(5000));

    const rows = mountedRows();
    const lastMounted = rows[rows.length - 1];
    lastMounted?.focus();
    fireEvent.keyDown(lastMounted ?? document.body, { key: "ArrowDown" });

    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: expect.any(Number) as number }),
    );
  });

  it("öffnet per Rechtsklick das Kontextmenü und committet eine Umbenennung über explorer_rename", async () => {
    renderPanel([{ name: "readme.md", isDirectory: false }]);

    const row = mountedRows()[0];
    if (!row) throw new Error("Baumzeile nicht gefunden");
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menuitem", { name: "Umbenennen" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Löschen" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Pfad kopieren" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Relativen Pfad kopieren" }),
    ).toBeInTheDocument();
    // VS Code ist laut Mock nicht installiert — der Eintrag darf gar nicht brandlint-ok: funktionaler Test-Assert für reales Menü
    // erst erscheinen (der Menüaufbau prüft das serverseitig, nicht per CSS).
    expect(
      screen.queryByRole("menuitem", { name: "In VS Code öffnen" }), // brandlint-ok: funktionaler UI-Text-Assert
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Umbenennen" }));

    const input = screen.getByRole("textbox", { name: "„readme.md“ umbenennen" });
    fireEvent.change(input, { target: { value: "notes.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Die Zusammensetzung projekt-relativ → absolut ist genau das, was
    // `commitRename` in ExplorerPanel.tsx leistet — hier über das tatsächlich
    // beim Backend ankommende Argumentpaar nachgewiesen, nicht über die
    // Implementierung selbst.
    await vi.waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("explorer_rename", {
        from: "/Users/dev/projects/storefront/readme.md",
        to: "/Users/dev/projects/storefront/notes.md",
      });
    });
  });

  it("kopiert den Pfad über den synchronen execCommand-Weg, nicht über die unzuverlässige Async Clipboard API", () => {
    // Derselbe WKWebView-Befund wie `terminal/clipboard.ts`s Kopfkommentar zu
    // `copyTextToClipboard`: ein Callback, der erst nach der Schließ-
    // Animation eines Radix-Kontextmenüs feuert, verliert dort die
    // "transient activation" — `navigator.clipboard.writeText()` schlägt
    // dann lautlos fehl, während die Kopiert-Quittung trotzdem erscheint
    // (das gemeldete Symptom: Toast da, Zwischenablage leer). Dieser Test
    // beweist den zuverlässigen Weg, indem er `execCommand("copy")` spioniert
    // — genau das Muster, das `clipboard.test.ts` für den Terminal-Copy
    // bereits etabliert hat.
    const execCommand = vi.fn().mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- nur der Typ wird referenziert, siehe clipboard.ts für die Begründung
    document.execCommand = execCommand;
    onTestFinished(() => {
      Reflect.deleteProperty(document, "execCommand");
    });

    renderPanel([{ name: "readme.md", isDirectory: false }]);

    const row = mountedRows()[0];
    if (!row) throw new Error("Baumzeile nicht gefunden");
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Pfad kopieren" }));

    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("löscht ohne Rückfrage, wenn explorer.confirmBeforeDelete auf false steht (Ticket 05)", async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "settings_get_schema") return Promise.resolve([]);
      if (cmd === "settings_get_values") {
        return Promise.resolve({ "explorer.confirmBeforeDelete": false });
      }
      return Promise.resolve();
    });

    renderPanel([{ name: "readme.md", isDirectory: false }]);

    // `useSettings` lädt asynchron über IPC — erst abwarten, sonst greift
    // beim Klick noch der Default (`true`, s. useSettings-Doku oben). Der
    // `act`-Flush danach lässt die bereits aufgelöste Antwort tatsächlich
    // noch als State-Update ankommen, bevor geklickt wird.
    await vi.waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("settings_get_values");
    });
    await act(() => Promise.resolve());

    const row = mountedRows()[0];
    if (!row) throw new Error("Baumzeile nicht gefunden");
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Löschen" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("explorer_delete", {
        path: "/Users/dev/projects/storefront/readme.md",
      });
    });

    // Wieder auf den Datei-weiten Default zurück, damit ein späterer Lauf
    // (anderer Testfile-Prozess, `--watch`) nicht an dieser Überschreibung hängen bleibt.
    vi.mocked(invoke).mockImplementation(() => Promise.resolve());
  });
});
