import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Tooltip } from "radix-ui";
import { ExplorerPanel } from "./ExplorerPanel";
import type { GitDecorations } from "../types/gitStatus";
import type { Project, TreeNode } from "../types/project";

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
        onCollapsedChange={() => undefined}
        onSelectFile={() => undefined}
        onCollapse={() => undefined}
        onRefresh={() => undefined}
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
    kind: "ts" as const,
  }));

describe("ExplorerPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
      { name: "src", children: [{ name: "main.rs" }, { name: "lib.rs" }] },
      { name: "README.md", kind: "md" },
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
          children: [
            { name: "core", children: [{ name: "main.rs", kind: "rs" }] },
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
});
