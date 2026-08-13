import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import App from "./App";

// Unter jsdom läuft weder eine Tauri-Runtime noch ein echtes xterm.js (das
// misst Zellgrößen am realen Renderer). Gemockt wird deshalb genau die
// Außengrenze: IPC-Brücke, Ordner-Dialog, Öffnen-mit-dem-System, Webview-
// Drag-Drop und xterm selbst. Geprüft wird damit die Verdrahtung Picker →
// pty_spawn; die eigentliche PTY-Logik ist bereits in Rust getestet, tiefere
// xterm-Rendering-Details sind hier bewusst nicht testbar.

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({
  // `settings_get_schema`/`settings_get_values` bekommen einen expliziten
  // Leer-Default: ExplorerPanel hängt seit Ticket 05 über `useSettings` am
  // Kommandosurface (live "explorer.confirmBeforeDelete"), ein generisches
  // `Promise.resolve()` (also `undefined`) würde dessen Zustand kaputt
  // machen, statt schlicht "noch nichts überschrieben".
  invoke: vi.fn((cmd: string) => {
    if (cmd === "settings_get_schema") return Promise.resolve([]);
    if (cmd === "settings_get_values") return Promise.resolve({});
    return Promise.resolve();
  }),
  Channel: class {
    onmessage: (payload: number[]) => void = () => undefined;
  },
}));

// ExplorerPanel/useSettings abonniert `settings:changed` fürs Live-Reload
// (Ticket 05) — ohne Mock griffe der echte Tauri-`listen()` nach internem
// Bridge-Zustand, den es unter jsdom nicht gibt.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

// Greift in die xterm-Attrappe hinein: der Tastatur-Handler der Pane wird nur
// an xterm übergeben, ist von außen also sonst nicht auslösbar, und der
// Schriftzoom wirkt genau auf terminal.options.fontSize.
//
// EINE Instanz pro `Terminal`-Konstruktion (Ticket 03, Mehrfach-Pane): früher
// teilten sich alle Panes denselben `options`/`fit`/`keyHandler` — mit
// mehreren echten Terminals wäre "Pane-Zoom wirkt nur auf die fokussierte
// Pane" gar nicht mehr prüfbar, ein grüner Test hätte nichts mehr ausgesagt.
// Panes entstehen in Render-Reihenfolge, `instances[i]` adressiert also die
// i-te gemountete Pane — für die bestehenden Einzel-Pane-Tests bleibt das
// schlicht `instances[0]`.
interface XtermInstance {
  options: { fontSize?: number };
  fit: ReturnType<typeof vi.fn<() => void>>;
  keyHandler: ((event: KeyboardEvent) => boolean) | null;
  /** Der an `terminal.onData` übergebene Handler — simuliert Tippen in GENAU
   * dieser Pane, ohne die anderen Instanzen zu berühren. */
  dataHandler: ((data: string) => void) | null;
}

const xterm = vi.hoisted(() => {
  const instances: XtermInstance[] = [];
  return { instances };
});

const setZoomMock = vi.hoisted(() =>
  vi.fn<(zoom: number) => Promise<void>>(() => Promise.resolve()),
);

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => undefined)),
    setZoom: setZoomMock,
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  // `activate(terminal)` ist der reale xterm-Vertrag: `Terminal.loadAddon`
  // ruft ihn mit sich selbst auf. Die Attrappe nutzt das, um `fit()` an genau
  // die `XtermInstance` der Pane zu binden, die sie geladen hat — nicht an
  // eine globale Attrappe.
  FitAddon: class {
    private instance: XtermInstance | null = null;
    // Referenz aufs ganze Mock-Terminal (nicht nur dessen __xterm-Sonde):
    // proposeDimensions() unten liest cols/rows live von dort, dieselben
    // Felder, die terminal.resize() weiter unten verändert.
    private dimensions: { cols: number; rows: number } | null = null;
    activate(terminal: { __xterm: XtermInstance; cols: number; rows: number }): void {
      this.instance = terminal.__xterm;
      this.dimensions = terminal;
    }
    dispose(): void {
      /* no-op */
    }
    fit(): void {
      this.instance?.fit();
    }
    // Ersetzt seit resizeGate.ts fit() als Mess-Aufruf an den beiden echten
    // Call-Sites (Pane-Zoom, ResizeObserver) — pingt dieselbe fit-Sonde wie
    // zuvor fit() selbst, damit bestehende Tests (die sie als Nachweis "eine
    // Größenmessung fand statt" lesen) unverändert gültig bleiben.
    proposeDimensions(): { cols: number; rows: number } | undefined {
      this.instance?.fit();
      return this.dimensions
        ? { cols: this.dimensions.cols, rows: this.dimensions.rows }
        : undefined;
    }
  },
}));

// Der WebGL-Renderer gehört zu derselben gemockten Außengrenze wie xterm
// selbst — in jsdom gibt es keinen GL-Kontext, und mit der Terminal-Attrappe
// hier gäbe es auch keinen Kern, an den er sich hängen könnte. Ohne diese
// Attrappe liefe schlicht JEDER Test dieser Datei über den Fallback-Pfad in
// `usePtyTerminal.ts`, und die beiden Fälle wären nicht mehr auseinander-
// zuhalten. Die Sonde pro Instanz macht genau das prüfbar: geladen (unten
// „Terminal-Renderer") vs. fehlgeschlagen (`webgl.failOnActivate`).
interface WebglAddonProbe {
  activated: boolean;
  disposed: boolean;
  /** Der über `onContextLoss` hinterlegte Handler — mit ihm lässt sich der
   * Kontextverlust auslösen, ohne echtes WebGL. */
  contextLoss: (() => void) | null;
}

const webgl = vi.hoisted(() => ({
  addons: [] as WebglAddonProbe[],
  /** Simuliert „kein WebGL2 verfügbar": das echte Addon wirft in genau diesem
   * Fall aus `activate()` heraus (`WebGL2 not supported`). */
  failOnActivate: false,
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    private readonly probe: WebglAddonProbe = (() => {
      const probe: WebglAddonProbe = {
        activated: false,
        disposed: false,
        contextLoss: null,
      };
      webgl.addons.push(probe);
      return probe;
    })();
    // Feld statt Methode: `onContextLoss` ist im echten Addon ein IEvent,
    // also eine aufrufbare Eigenschaft.
    readonly onContextLoss = (handler: () => void): { dispose: () => void } => {
      this.probe.contextLoss = handler;
      return { dispose: () => undefined };
    };
    activate(): void {
      if (webgl.failOnActivate) throw new Error("WebGL2 not supported null");
      this.probe.activated = true;
    }
    dispose(): void {
      this.probe.disposed = true;
    }
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 120;
    rows = 32;
    // Feld-Initialisierer laufen der Reihe nach — `__xterm` steht damit schon,
    // wenn `options` es referenziert.
    __xterm: XtermInstance = (() => {
      const instance: XtermInstance = {
        options: {},
        fit: vi.fn<() => void>(),
        keyHandler: null,
        dataHandler: null,
      };
      xterm.instances.push(instance);
      return instance;
    })();
    options = this.__xterm.options;
    // Leerer Puffer: resizeGate.ts fällt damit in jedem Test immer auf den
    // "sofort anwenden"-Zweig (kleiner Puffer, siehe dortige Schwelle) —
    // ohne das bräuchte jede spaltenändernde Größenanpassung hier
    // vi.useFakeTimers(), obwohl kein Test das Debouncing selbst prüft
    // (das deckt resizeGate.test.ts eigenständig ab).
    buffer = { active: { length: 0 } };
    resize(cols: number, rows: number): void {
      this.cols = cols;
      this.rows = rows;
    }
    open(): void {
      /* no-op */
    }
    loadAddon(addon: { activate: (terminal: unknown) => void }): void {
      addon.activate(this);
    }
    write(): void {
      /* no-op */
    }
    focus(): void {
      /* no-op */
    }
    clear(): void {
      /* no-op */
    }
    paste(): void {
      /* no-op */
    }
    dispose(): void {
      /* no-op */
    }
    getSelection(): string {
      return "";
    }
    hasSelection(): boolean {
      return false;
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      this.__xterm.keyHandler = handler;
    }
    onData(handler: (data: string) => void): { dispose: () => void } {
      this.__xterm.dataHandler = handler;
      return { dispose: () => undefined };
    }
    onResize(): { dispose: () => void } {
      return { dispose: () => undefined };
    }
    onWriteParsed(): { dispose: () => void } {
      return { dispose: () => undefined };
    }
    onCursorMove(): { dispose: () => void } {
      return { dispose: () => undefined };
    }
    parser = {
      registerOscHandler: (): { dispose: () => void } => ({
        dispose: () => undefined,
      }),
    };
  },
}));

const openMock = vi.mocked(open);
const openPathMock = vi.mocked(openPath);
const invokeMock = vi.mocked(invoke);

// Quad zeigt seit Ticket 03 vier leere Slots statt der früheren einen
// vollflächigen Picker — die allermeisten Bestandstests wollen weiterhin
// "irgendein Projekt öffnen" und greifen dafür zu Slot 0 (der danach auch
// fokussiert ist, s. `assignProjectToSlot` in `gridState.ts`). Tests, die
// gezielt einen ANDEREN Slot brauchen, klicken direkt über
// `pickerButton(index)`.
const pickerButton = (index: number) => {
  const button = screen.getAllByRole("button", { name: "Projekt wählen" })[
    index
  ];
  if (!button) throw new Error(`Kein leerer Slot-Picker an Index ${index}`);
  return button;
};

const clickPicker = () => fireEvent.click(pickerButton(0));

// Beide Schließen-Kreuze (Pane, Terminal-Tab) fragen seit den
// Schließen-Rückfragen zurück — jeder Schließen-Weg in diesen Tests führt
// deshalb über eine Bestätigung, und die Prüfung darunter (killt genau diese
// PTY, lässt jene stehen) beginnt erst danach.
//
// Auf den Dialog gescoped statt ungescoped: die Beschriftung „Pane schließen"
// trägt auch das Kreuz im Pane-Kopf, das die Rückfrage gerade ausgelöst hat.
const confirmClose = async (name: string) => {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name }));
};

// Seit PaneTabs.tsx (2026-08-12) trägt der Datei-Tab im Pane-Header denselben
// ", ungespeichert"-Zusatz wie die Baumzeile in ExplorerPanel.tsx (bewusst
// identischer Wortlaut, siehe DirtyMark dort) — ein ungescoptes
// `getByRole("button", { name: /…, ungespeichert/ })` matcht seither BEIDE
// und wirft "multiple elements". Scoped auf `<aside>` (Rolle "complementary"),
// den Explorer-Landmark: die Tests hier wollten immer die BAUMZEILE treffen
// (die einzige, die vor diesem Feature überhaupt "button" hieß — der Tab
// existierte noch nicht), nicht die neue Pane-Kopfzeile.
const explorerTreeButton = (name: RegExp | string) =>
  within(screen.getByRole("complementary")).getByRole("button", { name });

// Die Antwort von `explorer_read_file` in der Form, die `useFileEditor`
// erwartet — ein bloßes `Promise.resolve()` (der Default-Mock) landet im
// Fehlerzweig, weil der Hook `text`/`stamp` daraus liest.
const FILE_CONTENTS = {
  text: "fn main() {\n    println!(\"hallo\");\n}\n",
  crlf: false,
  stamp: { modified_ms: 1_700_000_000_000, len: 38 },
};

// Der Text, den der Nutzer in den Tests tippt, und der Stempel, den
// `explorer_write_file` bei Erfolg zurückgibt (frischer Zeitpunkt, neue
// Länge — genau das, was der Hook danach als erwarteten Stand führt).
const EDITED_TEXT = "fn main() {\n    println!(\"tschüss\");\n}\n";
const SAVED_STAMP = { modified_ms: 1_700_000_060_000, len: 41 };

const CONFLICT_ERROR = () =>
  Promise.reject(new Error("Datei wurde außerhalb von PaneCrew geändert"));

// Top-Level statt in einem einzelnen `describe`: `xterm.instances` ist ein
// modulweit geteiltes Array, das sonst über die ganze Testdatei hinweg
// akkumuliert — ein Test, der `instances[0]`/`[1]` adressiert (Mehrfach-Pane-
// Block unten), träfe damit still Instanzen aus längst abgeschlossenen
// Tests, nicht die eigenen. Läuft vor jedem einzelnen `it`, unabhängig vom
// umgebenden `describe`.
beforeEach(() => {
  xterm.instances.length = 0;
  webgl.addons.length = 0;
  webgl.failOnActivate = false;
});

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
  });

  it("zeigt vor der Projektwahl Quad mit vier leeren Slot-Pickern und noch keiner Terminal-Pane", () => {
    render(<App />);

    expect(
      screen.getAllByRole("button", { name: "Projekt wählen" }),
    ).toHaveLength(4);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    // get_launch_project läuft bei jedem Mount (siehe unten); nur pty_spawn
    // darf ohne Auswahl nie fallen.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "pty_spawn",
      expect.anything(),
    );
  });

  it("öffnet über das Zahnrad in der Titelleiste das Settings-Fenster (Ticket 03)", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }));

    // Das Fenster-Singleton (show/focus vs. neu bauen) lebt vollständig in
    // settings_window.rs::show — die Titelleiste selbst kennt nur den einen
    // Befehl.
    expect(invokeMock).toHaveBeenCalledWith("settings_open_window");
  });

  it("überspringt den Picker, wenn ein CLI-Startprojekt vorliegt", async () => {
    invokeMock.mockImplementation((cmd) =>
      cmd === "get_launch_project"
        ? Promise.resolve("/Users/dev/projects/storefront")
        : Promise.resolve(),
    );
    render(<App />);

    expect(
      await screen.findByLabelText("Terminal storefront"),
    ).toBeInTheDocument();
    // Slot 0 zeigt jetzt die Pane, die übrigen drei Quad-Slots bleiben leere
    // Picker — Quad verschwindet nie als Ganzes, anders als der frühere
    // vollflächige Picker.
    expect(
      screen.getAllByRole("button", { name: "Projekt wählen" }),
    ).toHaveLength(3);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ cwd: "/Users/dev/projects/storefront" }),
      );
    });
  });

  it("bleibt beim Picker, wenn kein CLI-Startprojekt vorliegt", async () => {
    invokeMock.mockImplementation((cmd) =>
      cmd === "get_launch_project" ? Promise.resolve(null) : Promise.resolve(),
    );
    render(<App />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_launch_project");
    });
    expect(
      screen.getAllByRole("button", { name: "Projekt wählen" }),
    ).toHaveLength(4);
  });

  it("startet nach der Ordnerauswahl ein PTY im gewählten Verzeichnis", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    // Explizit auf einen leeren, aber ERFOLGREICHEN Baum-Read gemockt: ohne
    // das würde der Default-Mock (`undefined`) beim Mappen einen Fehler
    // auslösen und die eigene Fehleranzeige zeigen statt des Leer-Zustands,
    // den dieser Test eigentlich prüfen will.
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({
          tabId: expect.any(String) as unknown,
          cwd: "/Users/dev/projects/storefront",
          cols: 120,
          rows: 32,
        }),
      );
    });

    // Der Ordnername trägt Pane-Header und Explorer-Kopf.
    expect(
      await screen.findByLabelText("Terminal storefront"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("storefront")).toHaveLength(2);
    expect(screen.getByText("Kein Dateibaum geladen.")).toBeInTheDocument();
  });

  it("zeigt eine eigene Fehlermeldung, wenn der Dateibaum nicht gelesen werden kann", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir"
        ? Promise.reject(new Error("Permission denied (os error 13)"))
        : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Permission denied (os error 13)",
    );
    expect(
      screen.queryByText("Kein Dateibaum geladen."),
    ).not.toBeInTheDocument();
  });

  it("liest beim Öffnen eines Projekts auch dessen Git-Status", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    expect(invokeMock).toHaveBeenCalledWith("explorer_git_status", {
      root: "/Users/dev/projects/storefront",
    });
  });

  it("liest Baum und Git-Status neu, wenn der Refresh-Knopf gedrückt wird", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    invokeMock.mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: "Dateibaum aktualisieren" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("explorer_read_dir", {
        path: "/Users/dev/projects/storefront",
      });
    });
    expect(invokeMock).toHaveBeenCalledWith("explorer_git_status", {
      root: "/Users/dev/projects/storefront",
    });
  });

  it("legt über den 'Neue Datei'-Knopf eine Datei an und liest den Baum danach neu", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    // explorer_read_file gehört seit dem Mini-Editor mit in diesen Mock: die
    // Anlege-Zeile meldet den neuen Namen über `onSelectFile`, und der öffnet
    // die Datei jetzt zusätzlich. Ohne das liefe der Öffnen-Pfad in den
    // Default-Mock und die Fläche zeigte hier einen Fehler.
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "explorer_read_dir") return Promise.resolve([]);
      if (cmd === "explorer_read_file") {
        return Promise.resolve({ ...FILE_CONTENTS, text: "" });
      }
      return Promise.resolve();
    });
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    invokeMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Neue Datei" }));
    const input = screen.getByLabelText("Neuer Dateiname");
    fireEvent.change(input, { target: { value: "notes.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("explorer_create_file", {
        path: "/Users/dev/projects/storefront/notes.md",
      });
    });
    expect(invokeMock).toHaveBeenCalledWith("explorer_read_dir", {
      path: "/Users/dev/projects/storefront",
    });
  });

  it("legt über den 'Neuer Ordner'-Knopf einen Ordner an", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    invokeMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Neuer Ordner" }));
    const input = screen.getByLabelText("Neuer Ordnername");
    fireEvent.change(input, { target: { value: "assets" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("explorer_create_directory", {
        path: "/Users/dev/projects/storefront/assets",
      });
    });
  });

  it("lehnt beim Anlegen einen Namen mit Pfadtrennzeichen ab, ohne das Backend aufzurufen", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    invokeMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Neue Datei" }));
    const input = screen.getByLabelText("Neuer Dateiname");
    fireEvent.change(input, { target: { value: "nested/notes.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/pfad/i);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "explorer_create_file",
      expect.anything(),
    );
  });

  it("verwirft die Anlege-Zeile bei Escape, ohne das Backend aufzurufen", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    invokeMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Neue Datei" }));
    const input = screen.getByLabelText("Neuer Dateiname");
    fireEvent.change(input, { target: { value: "notes.md" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByLabelText("Neuer Dateiname")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "explorer_create_file",
      expect.anything(),
    );
  });

  it("filtert den Baum über die Kopfzeilen-Suche und zeigt nur den Pfad zu Treffern", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    // Die Suche läuft seit dem Umbau auf Lazy-Loading (2026-08-13) über einen
    // eigenen Voll-Baum-Walk (`explorer_search_names`), nicht mehr über
    // clientseitiges Filtern des bereits geladenen Baums.
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "explorer_read_dir") {
        return Promise.resolve([
          { name: "src", is_dir: true },
          { name: "README.md", is_dir: false },
        ]);
      }
      if (cmd === "explorer_search_names") {
        return Promise.resolve({
          nodes: [
            {
              name: "src",
              is_dir: true,
              children: [{ name: "main.tsx", is_dir: false }],
            },
          ],
          truncated: false,
        });
      }
      return Promise.resolve();
    });
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    await screen.findByText("README.md");

    fireEvent.click(screen.getByRole("button", { name: "Dateien filtern" }));
    const input = screen.getByLabelText("Dateien im Projekt filtern");
    fireEvent.change(input, { target: { value: "main" } });

    expect(await screen.findByText("main.tsx")).toBeInTheDocument();
    expect(screen.queryByText("App.tsx")).not.toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
  });

  it("meldet eine eigene 'keine Treffer'-Auskunft statt des Leer-Platzhalters", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "explorer_read_dir") {
        return Promise.resolve([{ name: "README.md", is_dir: false }]);
      }
      if (cmd === "explorer_search_names") {
        return Promise.resolve({ nodes: [], truncated: false });
      }
      return Promise.resolve();
    });
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    await screen.findByText("README.md");

    fireEvent.click(screen.getByRole("button", { name: "Dateien filtern" }));
    fireEvent.change(screen.getByLabelText("Dateien im Projekt filtern"), {
      target: { value: "zzz-no-match" },
    });

    expect(
      await screen.findByText("Keine Treffer für „zzz-no-match“."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Kein Dateibaum geladen."),
    ).not.toBeInTheDocument();
  });

  it("stellt bei Escape den vollständigen, unveränderten Baum wieder her", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "explorer_read_dir") {
        return Promise.resolve([
          { name: "App.tsx", is_dir: false },
          { name: "main.tsx", is_dir: false },
        ]);
      }
      if (cmd === "explorer_search_names") {
        return Promise.resolve({
          nodes: [{ name: "main.tsx", is_dir: false }],
          truncated: false,
        });
      }
      return Promise.resolve();
    });
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    await screen.findByText("App.tsx");

    fireEvent.click(screen.getByRole("button", { name: "Dateien filtern" }));
    const input = screen.getByLabelText("Dateien im Projekt filtern");
    fireEvent.change(input, { target: { value: "main" } });
    expect(screen.queryByText("App.tsx")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      screen.queryByLabelText("Dateien im Projekt filtern"),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(screen.getByText("main.tsx")).toBeInTheDocument();
  });

  it("deaktiviert die Suche, solange der Dateibaum nicht gelesen werden konnte", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir"
        ? Promise.reject(new Error("Permission denied"))
        : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    await screen.findByRole("alert");

    expect(
      screen.getByRole("button", { name: "Dateien filtern" }),
    ).toBeDisabled();
  });

  it("markiert eine geänderte Datei im zugänglichen Namen ihrer Baumzeile", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "explorer_read_dir") {
        return Promise.resolve([{ name: "App.tsx", is_dir: false }]);
      }
      if (cmd === "explorer_git_status") {
        return Promise.resolve([{ path: "App.tsx", status: "modified" }]);
      }
      return Promise.resolve();
    });
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    expect(
      await screen.findByRole("button", { name: /App\.tsx,\s*geändert/ }),
    ).toBeInTheDocument();
  });

  it("lädt nach der Ordnerauswahl den echten Dateibaum und zeigt ihn im Explorer", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir"
        ? Promise.resolve([
            { name: "src", is_dir: true },
            { name: "README.md", is_dir: false },
          ])
        : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    expect(invokeMock).toHaveBeenCalledWith("explorer_read_dir", {
      path: "/Users/dev/projects/storefront",
    });
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(
      screen.queryByText("Kein Dateibaum geladen."),
    ).not.toBeInTheDocument();
  });

  // Der Mini-Editor (.scratch/explorer-file-io/, Ticket 03). Geprüft wird die
  // Verdrahtung Baumzeile → explorer_read_file → Fläche; die Zustands-
  // übergänge selbst liegen in fileEditorState.test.ts.
  const openTreeFile = async (
    readFile: () => Promise<unknown> = () => Promise.resolve(FILE_CONTENTS),
    writeFile: () => Promise<unknown> = () => Promise.resolve(SAVED_STAMP),
  ) => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd, args) => {
      if (cmd === "explorer_read_dir") {
        const path = (args as { path: string }).path;
        // Lazy-Loading fragt pro aufgeklapptem Ordner einzeln nach — die
        // Wurzel liefert nur "src" als (noch unbeladenen) Ordner, "main.rs"
        // kommt erst über den zweiten Aufruf, wenn "src" aufgeklappt wird.
        // Zwei Dateien an der Wurzel, weil der Verlassen-Guard aus Ticket 05
        // ein ZIEL braucht: „Wechsel auf eine andere Datei" ist ohne zweite
        // Zeile im Baum nicht auslösbar.
        if (path === "/Users/dev/projects/storefront/src") {
          return Promise.resolve([{ name: "main.rs", is_dir: false }]);
        }
        return Promise.resolve([
          { name: "src", is_dir: true },
          { name: "README.md", is_dir: false },
        ]);
      }
      if (cmd === "explorer_read_file") return readFile();
      if (cmd === "explorer_write_file") return writeFile();
      return Promise.resolve();
    });
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    // Ordner starten seit 2026-08-12 eingeklappt — "src" muss erst geöffnet
    // werden, bevor "main.rs" darin überhaupt eine Zeile bekommt.
    fireEvent.click(await screen.findByRole("button", { name: "src" }));
    fireEvent.click(await screen.findByRole("button", { name: "main.rs" }));
  };

  // Bewusst über die Rolle und nicht über `findByDisplayValue`: dessen
  // Standard-Normalisierer zieht Zeilenumbrüche zu Leerzeichen zusammen und
  // fände mehrzeiligen Quelltext nie wieder. `toHaveValue` vergleicht exakt.
  const editorTextbox = () =>
    screen.findByRole("textbox", { name: "Inhalt von main.rs" });

  const typeIntoEditor = async (text: string) => {
    fireEvent.change(await editorTextbox(), { target: { value: text } });
  };

  // jsdom meldet keine macOS-Kennung, es gilt hier also die Strg-Belegung.
  // `code` statt `key`, weil die Registry die physische Tastenposition prüft.
  // Ausgelöst wird am Textfeld — genau die Geste aus dem Ticket; dass der
  // Handler an der ganzen Fläche hängt, ist Zugabe.
  const pressSaveShortcut = async () => {
    fireEvent.keyDown(await editorTextbox(), { code: "KeyS", ctrlKey: true });
  };

  it("öffnet eine angeklickte Datei mit ihrem absoluten Pfad und zeigt den Inhalt", async () => {
    await openTreeFile();

    // Der Baum führt projekt-relative Pfade, das Backend will einen absoluten:
    // genau diese Zusammensetzung ist hier der Prüfgegenstand.
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("explorer_read_file", {
        path: "/Users/dev/projects/storefront/src/main.rs",
      });
    });
    expect(await editorTextbox()).toHaveValue(FILE_CONTENTS.text);
    expect(await screen.findByLabelText("Datei main.rs")).toBeInTheDocument();
  });

  it("blendet die Terminal-Pane nur aus, statt sie zu schließen", async () => {
    await openTreeFile();
    await editorTextbox();

    // Der harte Constraint dieses Tickets: der Effekt-Cleanup von
    // usePtyTerminal ruft pty_kill. Die Pane muss also im Dokument bleiben und
    // darf nur unsichtbar werden — sonst stirbt die echte Shell samt allem,
    // was gerade darin läuft.
    const pane = screen.getByLabelText("Terminal storefront");
    expect(pane).toBeInTheDocument();
    expect(pane).not.toBeVisible();
    expect(invokeMock).not.toHaveBeenCalledWith("pty_kill", expect.anything());
  });

  it("gibt das Rechteck beim Schließen der Datei ans Terminal zurück", async () => {
    await openTreeFile();
    await editorTextbox();

    fireEvent.click(screen.getByRole("button", { name: "Datei schließen" }));

    expect(
      screen.queryByRole("textbox", { name: "Inhalt von main.rs" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Terminal storefront")).toBeVisible();
    expect(invokeMock).not.toHaveBeenCalledWith("pty_kill", expect.anything());
  });

  it("zeigt den Fehlertext des Backends und bietet den externen Editor an", async () => {
    await openTreeFile(() =>
      Promise.reject(new Error("Datei ist zu groß für den Editor")),
    );

    // Der Rohtext aus Rust unterscheidet die Fälle („zu groß", „kein
    // UTF-8-Text") bereits genauer als jede eigene Ersatzformulierung.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Datei ist zu groß für den Editor",
    );
    // Kein Puffer, kein Speichern-Knopf: ausgegraut hieße „im Moment nichts
    // zu schreiben" und behauptete damit einen Text, den es hier gar nicht
    // gibt.
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "In externem Editor öffnen" }),
    );
    expect(openPathMock).toHaveBeenCalledWith(
      "/Users/dev/projects/storefront/src/main.rs",
    );
  });

  // Bearbeiten und Speichern (Ticket 04). Auch hier nur die Verdrahtung —
  // die Zustandsübergänge liegen in fileEditorState.test.ts, das atomare
  // Schreiben in den Rust-Tests von explorer_fs.rs.
  it("schreibt den geänderten Text per Strg+S in dieselbe Datei zurück", async () => {
    await openTreeFile();
    await typeIntoEditor(EDITED_TEXT);
    invokeMock.mockClear();

    await pressSaveShortcut();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "explorer_write_file",
        // Der beim Laden erhaltene Stempel geht mit — er ist die ganze
        // Konflikterkennung: das Backend schreibt nur, wenn die Datei auf der
        // Platte seither unangetastet blieb.
        expect.objectContaining({
          path: "/Users/dev/projects/storefront/src/main.rs",
          contents: EDITED_TEXT,
          crlf: false,
          expected: FILE_CONTENTS.stamp,
        }),
      );
    });

    // Und danach Baum plus Git-Deko neu lesen: aus einer unveränderten
    // versionierten Datei wird durch genau dieses Schreiben ein „M".
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("explorer_read_dir", {
        path: "/Users/dev/projects/storefront",
      });
    });
    expect(invokeMock).toHaveBeenCalledWith("explorer_git_status", {
      root: "/Users/dev/projects/storefront",
    });
  });

  it("gibt den Speichern-Knopf erst mit einer Änderung frei und räumt die Markierung danach wieder ab", async () => {
    await openTreeFile();
    await editorTextbox();

    const saveButton = screen.getByRole("button", { name: "Speichern" });
    expect(saveButton).toBeDisabled();

    await typeIntoEditor(EDITED_TEXT);
    expect(saveButton).toBeEnabled();
    expect(
      explorerTreeButton(/main\.rs,\s*ungespeichert/),
    ).toBeInTheDocument();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "explorer_write_file",
        expect.objectContaining({ contents: EDITED_TEXT }),
      );
    });
    // „Nach erfolgreichem Speichern verschwindet die Ungespeichert-
    // Markierung" — an beiden Stellen, an denen sie steht.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    });
    expect(
      screen.queryByRole("button", { name: /ungespeichert/ }),
    ).not.toBeInTheDocument();
  });

  it("wechselt per Mini-Tab zurück zum Terminal, ohne die offene Datei zu schließen", async () => {
    await openTreeFile();
    await typeIntoEditor(EDITED_TEXT);

    // Mit offener Datei zeigt die Pane die Datei-Fläche, das Terminal ist
    // weiterhin gemountet (die PTY läuft unverändert weiter), nur ausgeblendet.
    expect(await editorTextbox()).toBeVisible();
    expect(screen.getByLabelText("Terminal storefront")).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Terminal 1" }));

    // Zurück im Terminal — und KEINE Rückfrage: anders als "Datei schließen"
    // verwirft ein bloßer Ansichtswechsel nichts.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Terminal storefront")).toBeVisible();
    // `queryByRole` schließt per HTML-`hidden` verborgene Elemente aus dem
    // Accessibility-Baum bereits aus (liefert `null`) — anders als beim
    // Terminal oben (dessen `aria-label` unabhängig vom Sichtbarkeitsstatus
    // greift) gibt es hier also gar kein Element, an dem `toBeVisible()`
    // prüfen könnte.
    expect(
      screen.queryByRole("textbox", { name: "Inhalt von main.rs" }),
    ).not.toBeInTheDocument();

    // Und zurück zur Datei: derselbe ungespeicherte Text steht noch da — der
    // Wechsel hat den Puffer nicht neu geladen. Auf die Terminal-Pane
    // gescoped, sonst träfe die Namensregex auch die gleichnamige Baumzeile
    // im Explorer daneben.
    fireEvent.click(
      within(screen.getByLabelText("Terminal storefront")).getByRole(
        "button",
        { name: /main\.rs,\s*ungespeichert/ },
      ),
    );
    expect(await editorTextbox()).toHaveValue(EDITED_TEXT);
    expect(screen.getByLabelText("Terminal storefront")).not.toBeVisible();
  });

  it("hält den getippten Text sichtbar, wenn das Backend das Schreiben ablehnt", async () => {
    await openTreeFile(undefined, CONFLICT_ERROR);
    await typeIntoEditor(EDITED_TEXT);

    await pressSaveShortcut();

    // Der Rohtext aus Rust, unverändert — er benennt den Fall genauer als
    // jede Ersatzformulierung.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Datei wurde außerhalb von PaneCrew geändert",
    );
    // Der eigentliche Punkt: die Meldung tritt NICHT an die Stelle des
    // Puffers. Was nicht auf die Platte kam, darf nicht auch noch vom
    // Bildschirm verschwinden.
    expect(await editorTextbox()).toHaveValue(EDITED_TEXT);
    expect(
      explorerTreeButton(/main\.rs,\s*ungespeichert/),
    ).toBeInTheDocument();
  });

  it("liest bei „Trotzdem überschreiben“ den Stand frisch und schreibt dann erneut", async () => {
    let attempt = 0;
    await openTreeFile(undefined, () => {
      attempt += 1;
      return attempt === 1 ? CONFLICT_ERROR() : Promise.resolve(SAVED_STAMP);
    });
    await typeIntoEditor(EDITED_TEXT);
    await pressSaveShortcut();

    const forceButton = await screen.findByRole("button", {
      name: "Trotzdem überschreiben",
    });
    invokeMock.mockClear();
    fireEvent.click(forceButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "explorer_write_file",
        expect.objectContaining({ contents: EDITED_TEXT }),
      );
    });
    // Reihenfolge ist hier die Aussage: erst der frische Platten-Stempel,
    // dann der Write damit. Mit dem alten Stempel liefe der Versuch in
    // exakt denselben Konflikt.
    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands.indexOf("explorer_read_file")).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf("explorer_read_file")).toBeLessThan(
      commands.indexOf("explorer_write_file"),
    );
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  // Der Verlassen-Guard (Ticket 05). Geprüft wird ausschließlich die
  // Verdrahtung Absicht → Rückfrage → Ausführung; dass `wouldLoseWork` genau
  // bei ungespeichertem Stand meldet, liegt in fileEditorState.test.ts.
  //
  // Radix macht alles außerhalb seines Portals `aria-hidden`, solange das
  // modale Fenster offen ist — `*ByRole`-Abfragen auf die Editorfläche
  // dahinter finden dann nichts. Der Puffer wird deshalb erst NACH dem
  // Schließen der Rückfrage geprüft, nie währenddessen.
  const dirtyEditorWithSecondFile = async () => {
    await openTreeFile();
    await typeIntoEditor(EDITED_TEXT);
    invokeMock.mockClear();
  };

  const leaveDialog = () => screen.findByRole("alertdialog");

  it("fragt vor dem Wechsel auf eine andere Datei nach, statt den Stand zu verwerfen", async () => {
    await dirtyEditorWithSecondFile();

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));

    // Die Rückfrage nennt die Datei, um die es geht — nicht die, auf die
    // geklickt wurde.
    expect(await leaveDialog()).toHaveTextContent("main.rs");
    // Der eigentliche Punkt: der Wechsel hat noch NICHT stattgefunden. Ein
    // Read der neuen Datei wäre bereits der Verlust, denn er setzt den
    // Editorzustand um.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "explorer_read_file",
      expect.anything(),
    );
  });

  it("führt den Wechsel nach dem Bestätigen der Rückfrage doch aus", async () => {
    await dirtyEditorWithSecondFile();
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    await leaveDialog();

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen verwerfen" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("explorer_read_file", {
        path: "/Users/dev/projects/storefront/README.md",
      });
    });
  });

  it("lässt beim Abbrechen den ungespeicherten Puffer unangetastet stehen", async () => {
    await dirtyEditorWithSecondFile();
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    await leaveDialog();

    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(await editorTextbox()).toHaveValue(EDITED_TEXT);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "explorer_read_file",
      expect.anything(),
    );
    // Und die Baumzeile hebt weiter die Datei hervor, die auch wirklich offen
    // ist — die Auswahl wandert nicht ohne den Editor mit.
    expect(
      explorerTreeButton(/main\.rs,\s*ungespeichert/),
    ).toBeInTheDocument();
  });

  it("fragt auch nach, wenn die Fläche über ihr Schließkreuz verlassen wird", async () => {
    await dirtyEditorWithSecondFile();

    fireEvent.click(screen.getByRole("button", { name: "Datei schließen" }));
    await leaveDialog();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(await editorTextbox()).toHaveValue(EDITED_TEXT);

    // Und nach dem Bestätigen gibt die Fläche das Rechteck wie gehabt frei.
    fireEvent.click(screen.getByRole("button", { name: "Datei schließen" }));
    await leaveDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen verwerfen" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "Inhalt von main.rs" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("Terminal storefront")).toBeVisible();
  });

  it("lädt die bereits offene Datei bei einem erneuten Klick nicht neu", async () => {
    await dirtyEditorWithSecondFile();

    fireEvent.click(explorerTreeButton(/main\.rs,\s*ungespeichert/));

    // Kein Wechsel, also keine Rückfrage — aber eben auch kein erneutes Lesen:
    // das überschriebe den getippten Stand wortlos mit dem Platteninhalt.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "explorer_read_file",
      expect.anything(),
    );
    expect(await editorTextbox()).toHaveValue(EDITED_TEXT);
  });

  it("killt beim Schließen genau die Pane, die gespawnt wurde", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    const spawnCall = invokeMock.mock.calls.find(([cmd]) => cmd === "pty_spawn");
    const tabId = (spawnCall?.[1] as { tabId: string }).tabId;

    fireEvent.click(screen.getByRole("button", { name: "Pane schließen" }));
    await confirmClose("Pane schließen");

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("pty_kill", { tabId });
    });
    // pty_kill ist laut IPC-Vertrag nicht idempotent — genau ein Aufruf.
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(1);
  });

  // Der eigentliche Zweck der Schließen-Rückfrage: das versehentlich
  // getroffene Kreuz. Geprüft wird deshalb nicht, dass ein Dialog erscheint,
  // sondern dass das Abbrechen die laufende Sitzung WIRKLICH unangetastet
  // lässt — ein Dialog, nach dessen Abbruch die PTY trotzdem stirbt, wäre
  // schlimmer als gar keiner.
  it("lässt die Pane beim Abbrechen der Schließen-Rückfrage laufen", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    fireEvent.click(screen.getByRole("button", { name: "Pane schließen" }));
    await confirmClose("Abbrechen");

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("Terminal storefront")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("pty_kill", expect.anything());
  });

  it("killt kein PTY, solange pty_spawn noch nicht aufgelöst ist", async () => {
    // Hängender Spawn: der Cleanup darf dann nichts killen, sonst antwortet
    // das Backend mit "unknown pane_id" und der echte Prozess bliebe stehen.
    invokeMock.mockImplementation((cmd) =>
      cmd === "pty_spawn" ? new Promise(() => undefined) : Promise.resolve(),
    );
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    const { unmount } = render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    unmount();

    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(0);
  });

  // Der wertvollste neue Fall aus Ticket 03: `tabId` kommt jetzt stabil vom
  // Aufrufer statt frisch pro Effekt-Durchlauf (`usePtyTerminal.ts`). Reacts
  // StrictMode führt Mount → Cleanup → Mount trotzdem weiter synchron im
  // selben Tick aus — ohne die Verzögerung vor dem eigentlichen
  // `pty_spawn`-Aufruf (`queueMicrotask` + `cancelled`-Prüfung in
  // `usePtyTerminal.ts`) gingen hier zwei echte Spawns für dieselbe Id in
  // Flug, und welcher überlebt entschiede reine Backend-Fertigstellungs-
  // reihenfolge statt React. Geprüft wird deshalb nicht nur "genau ein
  // Spawn", sondern auch, dass der SPAWN der letzte PTY-Lifecycle-Aufruf
  // bleibt — kein Kill, der ihn gleich wieder einholt.
  it("spawnt unter StrictMode genau eine lebende PTY statt zwei mit anschließendem Kill", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_spawn"),
      ).toHaveLength(1);
    });
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(0);

    const lifecycleCommands = invokeMock.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd) => cmd === "pty_spawn" || cmd === "pty_kill");
    expect(lifecycleCommands.at(-1)).toBe("pty_spawn");
  });

  // Der Griff ist sonst nur ziehbar, also für Tastaturbedienung unerreichbar.
  // jsdom liefert keine Pointer-Geometrie, die Tastenlogik ist aber genau der
  // Teil, der hier ohne Maus prüfbar ist.
  it("verstellt die Explorer-Breite per Pfeiltasten und hält die Grenzen ein", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    const { container } = render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    const separator = screen.getByRole("separator", {
      name: "Explorer-Breite anpassen",
    });
    const explorer = container.querySelector("aside");
    expect(explorer).toHaveStyle({ width: "224px" });

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(explorer).toHaveStyle({ width: "232px" });

    fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
    expect(explorer).toHaveStyle({ width: "200px" });
    expect(separator).toHaveAttribute("aria-valuenow", "200");

    // Untergrenze: weiter als EXPLORER_MIN_WIDTH darf es nicht gehen.
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
    }
    expect(explorer).toHaveStyle({ width: "180px" });
  });

  it("bricht ohne Ordnerauswahl ab, ohne ein PTY zu starten", async () => {
    openMock.mockResolvedValue(null);
    render(<App />);

    clickPicker();

    await waitFor(() => {
      expect(openMock).toHaveBeenCalled();
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "pty_spawn",
      expect.anything(),
    );
    expect(
      screen.getAllByRole("button", { name: "Projekt wählen" }),
    ).toHaveLength(4);
  });
});

// Mehrfach-Pane (Ticket 03, Schritt 5): Quad mit N unabhängigen PTYs. Jeder
// Test hier belegt mindestens zwei Slots — die Einzel-Pane-Fälle deckt der
// "App"-Block oben bereits ab.
describe("Grid / Mehrfach-Pane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
  });

  const spawnCallFor = (cwd: string) =>
    invokeMock.mock.calls.find(
      ([cmd, args]) =>
        cmd === "pty_spawn" && (args as { cwd: string }).cwd === cwd,
    );

  it("löst für einen gezielten Slot genau einen pty_spawn mit dessen cwd aus", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    // Alle vier Slots sind leer — Index 2 im DOM ist wörtlich Slot 2.
    fireEvent.click(pickerButton(2));
    await screen.findByLabelText("Terminal storefront");

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_spawn"),
      ).toHaveLength(1);
    });
    expect(spawnCallFor("/Users/dev/projects/storefront")).toBeTruthy();
  });

  it("startet zwei unabhängige PTYs für zwei verschiedene Ordner in zwei Slots", async () => {
    openMock
      .mockResolvedValueOnce("/Users/dev/projects/storefront")
      .mockResolvedValueOnce("/Users/dev/projects/admin");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    clickPicker();
    await screen.findByLabelText("Terminal admin");

    const spawnCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "pty_spawn",
    );
    expect(spawnCalls).toHaveLength(2);
    const tabIds = spawnCalls.map(
      ([, args]) => (args as { tabId: string }).tabId,
    );
    expect(new Set(tabIds).size).toBe(2);
  });

  it("erlaubt denselben Ordner in zwei Slots, ohne zu deduplizieren", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    clickPicker();
    await waitFor(() => {
      expect(screen.getAllByLabelText("Terminal storefront")).toHaveLength(2);
    });

    const spawnCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "pty_spawn",
    );
    expect(spawnCalls).toHaveLength(2);
    expect(
      spawnCalls.every(
        ([, args]) =>
          (args as { cwd: string }).cwd === "/Users/dev/projects/storefront",
      ),
    ).toBe(true);
    const tabIds = spawnCalls.map(
      ([, args]) => (args as { tabId: string }).tabId,
    );
    expect(new Set(tabIds).size).toBe(2);
  });

  it("schreibt Eingaben nur mit der tabId der Pane, in der getippt wurde", async () => {
    openMock
      .mockResolvedValueOnce("/Users/dev/projects/storefront")
      .mockResolvedValueOnce("/Users/dev/projects/admin");
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    clickPicker();
    await screen.findByLabelText("Terminal admin");

    const storefrontId = (
      spawnCallFor("/Users/dev/projects/storefront")?.[1] as {
        tabId: string;
      }
    ).tabId;
    const adminId = (
      spawnCallFor("/Users/dev/projects/admin")?.[1] as { tabId: string }
    ).tabId;

    // pty_resize läuft nur nach erfolgreich aufgelöstem Spawn (`syncSize` in
    // usePtyTerminal.ts) — ein zuverlässiges Signal, dass beide Sessions
    // wirklich "ready" sind, bevor simuliert getippt wird.
    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_resize"),
      ).toHaveLength(2);
    });

    // instances[0] = zuerst gemountete Pane (storefront), [1] = admin.
    xterm.instances[0]?.dataHandler?.("a");

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "pty_write",
        expect.objectContaining({ tabId: storefrontId }),
      );
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "pty_write",
      expect.objectContaining({ tabId: adminId }),
    );
  });

  it("killt beim Schließen einer Pane nur diese, die andere bleibt gemountet", async () => {
    openMock
      .mockResolvedValueOnce("/Users/dev/projects/storefront")
      .mockResolvedValueOnce("/Users/dev/projects/admin");
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    clickPicker();
    await screen.findByLabelText("Terminal admin");

    const storefrontId = (
      spawnCallFor("/Users/dev/projects/storefront")?.[1] as {
        tabId: string;
      }
    ).tabId;

    fireEvent.click(
      within(screen.getByLabelText("Terminal storefront")).getByRole(
        "button",
        { name: "Pane schließen" },
      ),
    );
    await confirmClose("Pane schließen");

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("pty_kill", {
        tabId: storefrontId,
      });
    });
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Terminal admin")).toBeInTheDocument();
  });

  it("öffnet, wechselt und schließt einen zweiten Terminal-Tab, ohne die laufende PTY des ersten zu killen", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    const storefrontId = (
      spawnCallFor("/Users/dev/projects/storefront")?.[1] as {
        tabId: string;
      }
    ).tabId;

    // Unscoped statt `within(irgendeine Pane-Referenz)`: sobald ein zweiter
    // Tab aktiv wird, liegt die Tab-Leiste des ERSTEN Tabs (identischer
    // Inhalt, per `tabs`-Prop dupliziert in jedem gemounteten Terminal-Tab,
    // s. PaneGrid.tsx) hinter `visibility: hidden` und fiele aus
    // Rollen-Queries heraus — eine früh eingefangene Elementreferenz auf
    // genau diese Kopie würde also nach dem Umschalten ins Leere greifen.
    // Da hier nur eine Pane existiert, ist genau eine Kopie je Zeitpunkt
    // sichtbar, unscoped bleibt also eindeutig.
    fireEvent.click(
      screen.getByRole("button", { name: "Weiteren Terminal-Tab öffnen" }),
    );

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_spawn"),
      ).toHaveLength(2);
    });
    const secondTabId = invokeMock.mock.calls
      .filter(([cmd]) => cmd === "pty_spawn")
      .map(([, args]) => (args as { tabId: string }).tabId)
      .find((id) => id !== storefrontId);
    expect(secondTabId).toBeTruthy();
    // Ein weiterer Tab spawnt eine zusätzliche PTY, killt aber keine.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "pty_kill",
      expect.anything(),
    );

    // Zurück zu Tab 1: bloßes Umschalten darf nie killen/respawnen — sonst
    // stürbe die laufende Session des Nutzers lautlos beim Tab-Wechsel.
    fireEvent.click(screen.getByRole("button", { name: "Terminal 1" }));
    expect(invokeMock).not.toHaveBeenCalledWith(
      "pty_kill",
      expect.anything(),
    );
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_spawn"),
    ).toHaveLength(2);

    // Tab 2 schließen: killt NUR dessen eigene PTY, nicht Tab 1.
    fireEvent.click(
      screen.getByRole("button", { name: "Terminal 2 schließen" }),
    );
    await confirmClose("Tab schließen");

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("pty_kill", {
        tabId: secondTabId,
      });
    });
    expect(invokeMock).not.toHaveBeenCalledWith("pty_kill", {
      tabId: storefrontId,
    });
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(1);
  });

  // Neuzuweisung eines BELEGTEN Slots (dritter der drei im Plan genannten
  // Verlassen-Wege, `App.tsx`s `assignProjectToSlot` guardet und vergisst
  // die verdrängte Pane bereits) hat in diesem Schritt noch keinen
  // UI-Auslöser — der echte Pro-Slot-Picker mit einer Neu-zuweisen-Geste ist
  // laut Plan-Tabelle Teil des Opus-Durchgangs (Schritt 8). Der Regressions-
  // test dafür (genau ein `pty_kill` mit der alten, genau ein `pty_spawn`
  // mit einer neuen `tabId`) gehört dorthin, sobald es einen Knopf gibt,
  // den ein Test drücken kann.

  it("folgt mit dem Explorer der zuletzt fokussierten Pane", async () => {
    openMock
      .mockResolvedValueOnce("/Users/dev/projects/storefront")
      .mockResolvedValueOnce("/Users/dev/projects/admin");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    clickPicker();
    await screen.findByLabelText("Terminal admin");

    // admin wurde zuletzt zugewiesen und ist damit fokussiert: sein Name
    // steht doppelt (eigener Pane-Header + Explorer-Kopf), storefronts nur
    // noch in seinem eigenen Pane-Header.
    await waitFor(() => {
      expect(screen.getAllByText("admin")).toHaveLength(2);
    });
    expect(screen.getAllByText("storefront")).toHaveLength(1);
  });

  it("blendet beim Datei-Öffnen nur das Terminal der fokussierten Pane aus, die andere bleibt sichtbar", async () => {
    openMock
      .mockResolvedValueOnce("/Users/dev/projects/storefront")
      .mockResolvedValueOnce("/Users/dev/projects/admin");
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "explorer_read_dir") {
        return Promise.resolve([{ name: "README.md", is_dir: false }]);
      }
      if (cmd === "explorer_read_file") return Promise.resolve(FILE_CONTENTS);
      return Promise.resolve();
    });
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    clickPicker();
    await screen.findByLabelText("Terminal admin");

    // admin ist fokussiert, der Explorer zeigt also dessen Baum.
    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));

    const adminPane = screen.getByLabelText("Terminal admin");
    const storefrontPane = screen.getByLabelText("Terminal storefront");
    await waitFor(() => {
      expect(adminPane).not.toBeVisible();
    });
    expect(storefrontPane).toBeVisible();
    // Storefronts eigener Editor bleibt idle (FileEditor rendert dann null)
    // — es gibt also nur EIN "Datei schließen"-Kreuz, nicht zwei.
    expect(
      screen.getAllByRole("button", { name: "Datei schließen" }),
    ).toHaveLength(1);
  });

  it("guardet nur die Pane mit ungespeichertem Stand, nicht die andere", async () => {
    openMock
      .mockResolvedValueOnce("/Users/dev/projects/storefront")
      .mockResolvedValueOnce("/Users/dev/projects/admin");
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "explorer_read_dir") {
        return Promise.resolve([{ name: "README.md", is_dir: false }]);
      }
      if (cmd === "explorer_read_file") return Promise.resolve(FILE_CONTENTS);
      return Promise.resolve();
    });
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    clickPicker();
    await screen.findByLabelText("Terminal admin");

    // admin (fokussiert) bekommt ungespeicherten Stand.
    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    const textbox = await screen.findByRole("textbox", {
      name: "Inhalt von README.md",
    });
    fireEvent.change(textbox, { target: { value: "geändert" } });

    // storefront hat nichts Ungespeichertes — sein Schließen bekommt deshalb
    // NUR die Schließen-Rückfrage, nicht die stärkere Ungespeichert-
    // Rückfrage, obwohl admin gerade ungespeicherten Stand hält. Genau diese
    // Unterscheidung ist der Punkt: der ungespeicherte Stand EINER Pane darf
    // nie den Weg einer anderen guarden. Seit den Schließen-Rückfragen reicht
    // dafür kein "gar kein Dialog" mehr — geprüft wird jetzt, WELCHER.
    fireEvent.click(
      within(screen.getByLabelText("Terminal storefront")).getByRole(
        "button",
        { name: "Pane schließen" },
      ),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Pane schließen?");
    expect(dialog).not.toHaveTextContent(
      "Ungespeicherte Änderungen verwerfen?",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Pane schließen" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByLabelText("Terminal storefront"),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // admins ungespeicherter Puffer blieb unangetastet.
    expect(textbox).toHaveValue("geändert");
  });

  it("erhält beim Wachsen (Quad→Viererreihe) alle Panes ohne Kill oder Spawn", async () => {
    openMock
      .mockResolvedValueOnce("/Users/dev/projects/a")
      .mockResolvedValueOnce("/Users/dev/projects/b");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal a");
    clickPicker();
    await screen.findByLabelText("Terminal b");
    invokeMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Viererreihe" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Viererreihe" }),
      ).toHaveAttribute("aria-pressed", "true");
    });
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(0);
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_spawn"),
    ).toHaveLength(0);
    expect(screen.getByLabelText("Terminal a")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal b")).toBeInTheDocument();
  });

  it("blockiert ein nicht passendes Schrumpfen mit Erklärtext, ohne etwas zu killen", async () => {
    openMock
      .mockResolvedValueOnce("/Users/dev/projects/a")
      .mockResolvedValueOnce("/Users/dev/projects/b")
      .mockResolvedValueOnce("/Users/dev/projects/c");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal a");
    clickPicker();
    await screen.findByLabelText("Terminal b");
    clickPicker();
    await screen.findByLabelText("Terminal c");
    invokeMock.mockClear();

    // Der Blockiert-Zustand UND die Begründung stehen schon vor dem Klick am
    // Knopf, aus `templateSwitchBlockReason` am Render — nicht erst danach.
    const splitButton = screen.getByRole("button", { name: /Geteilt/ });
    expect(splitButton).toBeDisabled();
    expect(splitButton).toHaveAccessibleName(/3.*2/);

    fireEvent.click(splitButton);

    // Blockiert bleibt blockiert: Quad weiterhin aktiv, keine Pane verschwunden.
    expect(
      screen.getByRole("button", { name: "Vierergrid" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(0);
    expect(screen.getByLabelText("Terminal a")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal b")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal c")).toBeInTheDocument();
  });

  it("kompaktiert beim erlaubten Schrumpfen (Quad→Geteilt, Panes an Slot 0 und 3) ohne Kill oder Spawn", async () => {
    openMock
      .mockResolvedValueOnce("/Users/dev/projects/storefront")
      .mockResolvedValueOnce("/Users/dev/projects/admin");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    fireEvent.click(pickerButton(0));
    await screen.findByLabelText("Terminal storefront");
    // Alle vier Slots sind noch leer bis auf Slot 0 — der dritte verbleibende
    // Picker (Index 2 unter den drei übrigen) ist Slot 3.
    fireEvent.click(pickerButton(2));
    await screen.findByLabelText("Terminal admin");
    invokeMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Geteilt" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Geteilt" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    // Der eigentliche Diskriminator: eine Kompaktierung bewegt DOM-Knoten
    // (paneId-Key bleibt stabil), sie unmountet nichts. Ein pro-Slot-Index
    // geschlüsselter Wrapper würde hier stattdessen einen Kill+Spawn zeigen.
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(0);
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_spawn"),
    ).toHaveLength(0);
    expect(screen.getByLabelText("Terminal storefront")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal admin")).toBeInTheDocument();
  });
});

// jsdom meldet keine macOS-Kennung, es gilt hier also die Strg-Belegung; dass
// beide Positionen und beide Plattformen gleich matchen, deckt registry.test.ts
// ab. Geprüft wird hier die Verdrahtung, nicht der Matcher.
describe("Zoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
  });

  // Jeder Test hier hält genau eine Pane offen (CLI-Start ODER der Picker) —
  // die einzige xterm-Instanz, die entstanden ist.
  const soloTerminal = () => {
    const instance = xterm.instances[0];
    if (!instance) throw new Error("Keine Pane gemountet");
    return instance;
  };

  // Der eigentliche Fallstrick: die nativen Ampeln skalieren nicht mit, der
  // Webview-Inhalt aber schon. Die Titelzeile skaliert deshalb per transform
  // dagegen; geprüft wird das Produkt aus beidem, nicht der Rohwert.
  it("hält den physischen Abstand zu den Ampeln über alle Zoomstufen konstant", () => {
    const { container } = render(<App />);
    const header = container.querySelector("header");
    const capsule = header?.firstElementChild as HTMLElement;

    const physicalInset = () => {
      const zoom = setZoomMock.mock.calls.at(-1)?.[0] ?? 1;
      const scale = Number.parseFloat(
        /scale\(([\d.]+)\)/.exec(header?.style.transform ?? "")?.[1] ?? "1",
      );
      return Number.parseFloat(capsule.style.paddingLeft) * scale * zoom;
    };
    const press = (code: string) =>
      fireEvent.keyDown(window, { code, ctrlKey: true, shiftKey: true });

    expect(physicalInset()).toBeCloseTo(84);
    press("Equal");
    press("Equal");
    expect(setZoomMock.mock.calls.at(-1)?.[0]).toBeGreaterThan(1);
    expect(physicalInset()).toBeCloseTo(84);

    press("Minus");
    press("Minus");
    press("Minus");
    expect(setZoomMock.mock.calls.at(-1)?.[0]).toBeLessThan(1);
    expect(physicalInset()).toBeCloseTo(84);

    press("Digit0");
    expect(setZoomMock).toHaveBeenLastCalledWith(1);
    expect(physicalInset()).toBeCloseTo(84);
  });

  // Der Fallstrick, den das Speichern-Kürzel aufgemacht hat: der
  // Tastatur-Handler der Pane nahm jeden Treffer mit `scope: "pane"` als Zoom
  // entgegen und leitete die Richtung aus dem Glyph ab. Cmd/Strg+S hätte dort
  // also die Schrift verkleinert und wäre nie bei der Shell angekommen —
  // ausgerechnet in einem Terminal, in dem Ctrl+S eine eigene Bedeutung hat.
  it("lässt Strg+S im Terminal unangetastet zur Shell durch", async () => {
    invokeMock.mockImplementation((cmd) =>
      cmd === "get_launch_project"
        ? Promise.resolve("/Users/dev/projects/storefront")
        : Promise.resolve(),
    );
    render(<App />);
    await screen.findByLabelText("Terminal storefront");

    const fontSizeBefore = soloTerminal().options.fontSize;
    const event = {
      type: "keydown",
      key: "s",
      code: "KeyS",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    };

    // true = xterm bearbeitet die Taste ganz normal weiter, schickt sie also
    // ans PTY. Ein abgefangenes Kürzel gäbe hier false zurück.
    expect(soloTerminal().keyHandler?.(event as unknown as KeyboardEvent)).toBe(
      true,
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(soloTerminal().options.fontSize).toBe(fontSizeBefore);
  });

  it("lässt Strg+Plus ohne Shift die Oberfläche unangetastet", () => {
    render(<App />);

    fireEvent.keyDown(window, { code: "Equal", ctrlKey: true });

    // Der Effekt beim Mounten setzt einmal die Ausgangsstufe; mehr nicht.
    expect(setZoomMock.mock.calls.map(([level]) => level)).toEqual([1]);
  });

  it("zoomt mit Strg+Plus die Pane-Schrift und meldet die neue Größe ans PTY", async () => {
    invokeMock.mockImplementation((cmd) =>
      cmd === "get_launch_project"
        ? Promise.resolve("/Users/dev/projects/storefront")
        : Promise.resolve(),
    );
    render(<App />);
    await screen.findByLabelText("Terminal storefront");

    const press = (code: string) => {
      const event = {
        type: "keydown",
        code,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault: vi.fn(),
      };
      soloTerminal().keyHandler?.(event as unknown as KeyboardEvent);
      return event.preventDefault;
    };

    const prevented = press("Equal");
    const enlarged = soloTerminal().options.fontSize;
    press("Digit0");
    const base = soloTerminal().options.fontSize;

    // Ohne preventDefault liefe der eingebaute Webview-Zoom auf derselben
    // Taste mit — die Pane-Schrift wüchse dann doppelt.
    expect(prevented).toHaveBeenCalled();
    expect(enlarged).toBeGreaterThan(base ?? 0);
    // fit() ist der Weg, auf dem die neue Zellengeometrie als pty_resize
    // beim Kindprozess ankommt.
    expect(soloTerminal().fit).toHaveBeenCalled();
    // Und die Oberfläche bleibt, wo sie war.
    expect(setZoomMock.mock.calls.map(([level]) => level)).toEqual([1]);
  });
});

describe("Sitzungspersistenz (Ticket 06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
  });

  const saveCalls = () =>
    invokeMock.mock.calls.filter(([cmd]) => cmd === "session_save");

  it("stellt Template und Pane-Zuordnungen aus einer gespeicherten Sitzung wieder her", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "session_load") {
        return Promise.resolve({
          windows: [
            {
              template: "split",
              slots: [
                {
                  project_path: "/Users/dev/projects/storefront",
                  terminal_tabs: [{}],
                  active_tab: { kind: "terminal", index: 0 },
                },
                null,
              ],
            },
          ],
        });
      }
      if (cmd === "get_launch_project") return Promise.resolve(null);
      return Promise.resolve();
    });

    render(<App />);

    expect(await screen.findByLabelText("Terminal storefront")).toBeInTheDocument();
    // Split hat zwei Slots, einer davon belegt — genau ein leerer Picker
    // bleibt übrig.
    expect(
      screen.getAllByRole("button", { name: "Projekt wählen" }),
    ).toHaveLength(1);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ cwd: "/Users/dev/projects/storefront" }),
      );
    });
  });

  it("stellt mehrere Terminal-Tabs samt aktivem Index wieder her, ohne einen davon zu killen", async () => {
    // Bisher deckten alle Restore-Tests nur `terminal_tabs: [{}]` ab (genau
    // ein Tab) — die interessante Schleife in `restoreSlot` (App.tsx), die
    // für einen dritten Parameter `terminalTabCount > 1` weitere Tabs via
    // `openTerminalTab` nachlegt und danach mit `switchToTerminalTab` auf den
    // gespeicherten `active_tab.index` zurückschaltet, war ungetestet.
    // `openTerminalTab` aktiviert dabei immer den zuletzt geöffneten Tab —
    // nach der Schleife stünde Tab 3 aktiv, ohne die abschließende Korrektur.
    // `index: 0` prüft genau diese Korrektur, nicht den ohnehin trivialen
    // Fall "letzter geöffneter Tab bleibt aktiv".
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "session_load") {
        return Promise.resolve({
          windows: [
            {
              template: "single",
              slots: [
                {
                  project_path: "/Users/dev/projects/storefront",
                  terminal_tabs: [{}, {}, {}],
                  active_tab: { kind: "terminal", index: 0 },
                },
              ],
            },
          ],
        });
      }
      if (cmd === "get_launch_project") return Promise.resolve(null);
      return Promise.resolve();
    });

    render(<App />);

    // Alle drei Terminal-Tabs sind gleichzeitig gemountet ("hidden but
    // mounted", s. Kopfkommentar zu `usePtyTerminal`), jeder mit demselben
    // projektbezogenen `aria-label` — anders als bei den Ein-Tab-Restore-
    // Tests oben liefert `findByLabelText` hier also drei Treffer, nicht
    // einen.
    expect(await screen.findAllByLabelText("Terminal storefront")).toHaveLength(3);
    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(
          ([cmd, args]) =>
            cmd === "pty_spawn" &&
            (args as { cwd: string }).cwd === "/Users/dev/projects/storefront",
        ),
      ).toHaveLength(3);
    });
    const spawnedTabIds = invokeMock.mock.calls
      .filter(([cmd]) => cmd === "pty_spawn")
      .map(([, args]) => (args as { tabId: string }).tabId);
    expect(new Set(spawnedTabIds).size).toBe(3);

    // Ohne die abschließende `switchToTerminalTab`-Korrektur stünde hier Tab
    // 3 aktiv (der zuletzt von `openTerminalTab` angelegte) statt des
    // gespeicherten Index 0.
    expect(screen.getByRole("button", { name: "Terminal 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(0);
  });

  it("öffnet die zuletzt ausgewählte Datei der wiederhergestellten Pane erneut", async () => {
    invokeMock.mockImplementation((cmd, args) => {
      if (cmd === "session_load") {
        return Promise.resolve({
          windows: [
            {
              template: "quad",
              slots: [
                {
                  project_path: "/Users/dev/projects/storefront",
                  terminal_tabs: [{}],
                  active_tab: { kind: "file" },
                  file_tab: { path: "src/App.tsx" },
                },
                null,
                null,
                null,
              ],
            },
          ],
        });
      }
      if (cmd === "get_launch_project") return Promise.resolve(null);
      if (
        cmd === "explorer_read_file" &&
        (args as { path: string }).path ===
          "/Users/dev/projects/storefront/src/App.tsx"
      ) {
        return Promise.resolve(FILE_CONTENTS);
      }
      return Promise.resolve();
    });

    render(<App />);

    await screen.findByLabelText("Terminal storefront");
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("explorer_read_file", {
        path: "/Users/dev/projects/storefront/src/App.tsx",
      });
    });
    // `findByDisplayValue` normalisiert Zeilenumbrüche zu Leerzeichen (s.
    // `editorTextbox` oben) — bei mehrzeiligem Inhalt geht das über die
    // Rolle, exakt vergleichend mit `toHaveValue`.
    expect(
      await screen.findByRole("textbox", { name: "Inhalt von App.tsx" }),
    ).toHaveValue(FILE_CONTENTS.text);
  });

  it("ein Slot ohne `file_tab`-Feld öffnet keine Datei namens \"undefined\"", async () => {
    // `session_store.rs` überspringt das Feld beim Schreiben ganz, wenn
    // nichts ausgewählt war (`skip_serializing_if`) — über die IPC-Brücke
    // kommt so ein Slot-Objekt ohne dieses Feld an, `file_tab` ist dann
    // `undefined`, nicht `null`. Ein zu strenger `=== null`-Check ließ das
    // früher durch und öffnete buchstäblich eine Datei "undefined"
    // (2026-08-12, Nutzerbeobachtung: alle Panes zeigen beim Start denselben
    // Lesefehler).
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "session_load") {
        return Promise.resolve({
          windows: [
            {
              template: "single",
              slots: [
                {
                  project_path: "/Users/dev/projects/storefront",
                  terminal_tabs: [{}],
                  active_tab: { kind: "terminal", index: 0 },
                },
              ],
            },
          ],
        });
      }
      if (cmd === "get_launch_project") return Promise.resolve(null);
      return Promise.resolve();
    });

    render(<App />);

    expect(await screen.findByLabelText("Terminal storefront")).toBeInTheDocument();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ cwd: "/Users/dev/projects/storefront" }),
      );
    });
    // Kein `last_selected_file` heißt: nichts zu öffnen — nicht "öffne die
    // Datei 'undefined'".
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "explorer_read_file"),
    ).toHaveLength(0);
    expect(
      screen.queryByText("Datei konnte nicht gelesen werden"),
    ).not.toBeInTheDocument();
  });

  it("ein CLI-Startprojekt gewinnt gegen Slot 0 der wiederhergestellten Sitzung", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "session_load") {
        return Promise.resolve({
          windows: [
            {
              template: "quad",
              slots: [
                {
                  project_path: "/Users/dev/projects/storefront",
                  terminal_tabs: [{}],
                  active_tab: { kind: "terminal", index: 0 },
                },
                null,
                null,
                null,
              ],
            },
          ],
        });
      }
      if (cmd === "get_launch_project") {
        return Promise.resolve("/Users/dev/projects/admin");
      }
      return Promise.resolve();
    });

    render(<App />);

    expect(await screen.findByLabelText("Terminal admin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Terminal storefront")).not.toBeInTheDocument();
  });

  it("fehlt eine gespeicherte Sitzung, bleibt es beim leeren Quad-Picker", async () => {
    invokeMock.mockImplementation((cmd) =>
      cmd === "session_load" ? Promise.resolve(null) : Promise.resolve(),
    );

    render(<App />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("session_load");
    });
    expect(
      screen.getAllByRole("button", { name: "Projekt wählen" }),
    ).toHaveLength(4);
  });

  it("speichert die Sitzung automatisch nach einer Ordnerauswahl, ohne einen expliziten Speichern-Schritt", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "session_load") return Promise.resolve(null);
      if (cmd === "get_launch_project") return Promise.resolve(null);
      if (cmd === "explorer_read_dir") return Promise.resolve([]);
      return Promise.resolve();
    });
    openMock.mockResolvedValue("/Users/dev/projects/storefront");

    render(<App />);
    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    await waitFor(() => {
      const [, payload] = saveCalls().at(-1) ?? [];
      const state = (
        payload as { state?: { windows: { slots: unknown[] }[] } } | undefined
      )?.state;
      expect(state?.windows[0]?.slots[0]).toEqual({
        project_path: "/Users/dev/projects/storefront",
        terminal_tabs: [{}],
        active_tab: { kind: "terminal", index: 0 },
        file_tab: null,
        adapter_id: null,
      });
    });
  });

  it("speichert die Sitzung nach einem Template-Wechsel", async () => {
    invokeMock.mockImplementation((cmd) =>
      cmd === "session_load" || cmd === "get_launch_project"
        ? Promise.resolve(null)
        : Promise.resolve(),
    );

    render(<App />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("session_load");
    });
    fireEvent.click(screen.getByRole("button", { name: "Geteilt" }));

    await waitFor(() => {
      const [, payload] = saveCalls().at(-1) ?? [];
      const state = (
        payload as { state?: { windows: { template: string }[] } } | undefined
      )?.state;
      expect(state?.windows[0]?.template).toBe("split");
    });
  });
});

// Der beschleunigte Renderer. Geprüft wird nicht, DASS WebGL zeichnet (dafür
// gibt es unter jsdom keinen Kontext), sondern dass die beiden Pfade in
// `usePtyTerminal.ts` überhaupt noch unterscheidbar sind: das Addon wird pro
// Pane geladen — und wenn es das nicht kann, bleibt die Pane trotzdem eine
// vollwertige Pane. Ohne den Erfolgsfall hier würde ein stillschweigend
// dauerhaft fallendes Addon von keinem einzigen Test dieser Datei bemerkt.
describe("Terminal-Renderer (WebGL)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Leerer, aber ERFOLGREICHER Baum-Read (wie oben schon bei den
    // Explorer-Tests): der Default-Mock liefert `undefined` und lässt den
    // Lade-Pfad in seine eigene Fehlerbehandlung samt console.error laufen —
    // in genau den Tests, die hier console.warn beobachten wollen, wäre das
    // vermeidbares Rauschen.
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_dir" || cmd === "explorer_git_status"
        ? Promise.resolve([])
        : Promise.resolve(),
    );
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
  });

  it("lädt für jede Pane genau ein WebGL-Addon und hängt sich an dessen Kontextverlust", async () => {
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    expect(webgl.addons).toHaveLength(1);
    expect(webgl.addons[0]?.activated).toBe(true);
    // Die Registrierung ist der eigentliche Prüfgegenstand: ohne sie stünde
    // die Pane nach einem GPU-Reset schwarz da, statt auf das DOM zurück-
    // zufallen.
    expect(webgl.addons[0]?.contextLoss).toBeTypeOf("function");
  });

  it("verwirft den WebGL-Renderer bei Kontextverlust, statt schwarz stehen zu bleiben", async () => {
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
    webgl.addons[0]?.contextLoss?.();

    // dispose() des Addons ist genau der dokumentierte Weg zurück zum
    // Standard-Renderer — das Terminal selbst bleibt unangetastet.
    expect(webgl.addons[0]?.disposed).toBe(true);
    expect(screen.getByLabelText("Terminal storefront")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("pty_kill", expect.anything());
  });

  it("startet die Pane auch ohne verfügbaren WebGL-Kontext vollständig", async () => {
    webgl.failOnActivate = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<App />);

    clickPicker();

    // Der Fallback ist erst dann einer, wenn die Pane danach wirklich alles
    // kann: Ausgabefläche steht, PTY läuft.
    expect(
      await screen.findByLabelText("Terminal storefront"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ cwd: "/Users/dev/projects/storefront" }),
      );
    });
    // Lautlos wäre falsch: „es ruckelt" ließe sich später sonst nicht von
    // einem echten Fehler unterscheiden.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("WebGL-Renderer nicht verfügbar");
    warn.mockRestore();
  });
});
