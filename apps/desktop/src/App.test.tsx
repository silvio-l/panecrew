import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  invoke: vi.fn(() => Promise.resolve()),
  Channel: class {
    onmessage: (payload: number[]) => void = () => undefined;
  },
}));

// Greift in die xterm-Attrappe hinein: der Tastatur-Handler der Pane wird nur
// an xterm übergeben, ist von außen also sonst nicht auslösbar, und der
// Schriftzoom wirkt genau auf terminal.options.fontSize.
const xterm = vi.hoisted(() => {
  const options: { fontSize?: number } = {};
  return {
    keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
    options,
    fit: vi.fn(),
  };
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
  FitAddon: class {
    activate(): void {
      /* no-op */
    }
    dispose(): void {
      /* no-op */
    }
    fit(): void {
      xterm.fit();
    }
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 120;
    rows = 32;
    open(): void {
      /* no-op */
    }
    loadAddon(): void {
      /* no-op */
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
    options = xterm.options;
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      xterm.keyHandler = handler;
    }
    onData(): { dispose: () => void } {
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

const clickPicker = () =>
  fireEvent.click(screen.getByRole("button", { name: "Projekt wählen" }));

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

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
  });

  it("zeigt vor der Projektwahl den Picker und noch keine Terminal-Pane", () => {
    render(<App />);

    expect(
      screen.getByRole("button", { name: "Projekt wählen" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    // get_launch_project läuft bei jedem Mount (siehe unten); nur pty_spawn
    // darf ohne Auswahl nie fallen.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "pty_spawn",
      expect.anything(),
    );
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
    expect(
      screen.queryByRole("button", { name: "Projekt wählen" }),
    ).not.toBeInTheDocument();
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
      screen.getByRole("button", { name: "Projekt wählen" }),
    ).toBeInTheDocument();
  });

  it("startet nach der Ordnerauswahl ein PTY im gewählten Verzeichnis", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    // Explizit auf einen leeren, aber ERFOLGREICHEN Baum-Read gemockt: ohne
    // das würde der Default-Mock (`undefined`) beim Mappen einen Fehler
    // auslösen und die eigene Fehleranzeige zeigen statt des Leer-Zustands,
    // den dieser Test eigentlich prüfen will.
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_tree" ? Promise.resolve([]) : Promise.resolve(),
    );
    render(<App />);

    clickPicker();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({
          paneId: expect.any(String) as unknown,
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
      cmd === "explorer_read_tree"
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
      expect(invokeMock).toHaveBeenCalledWith("explorer_read_tree", {
        root: "/Users/dev/projects/storefront",
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
      if (cmd === "explorer_read_tree") return Promise.resolve([]);
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
    expect(invokeMock).toHaveBeenCalledWith("explorer_read_tree", {
      root: "/Users/dev/projects/storefront",
    });
  });

  it("legt über den 'Neuer Ordner'-Knopf einen Ordner an", async () => {
    openMock.mockResolvedValue("/Users/dev/projects/storefront");
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_tree" ? Promise.resolve([]) : Promise.resolve(),
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
      cmd === "explorer_read_tree" ? Promise.resolve([]) : Promise.resolve(),
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
      cmd === "explorer_read_tree" ? Promise.resolve([]) : Promise.resolve(),
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
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_tree"
        ? Promise.resolve([
            {
              name: "src",
              children: [{ name: "App.tsx" }, { name: "main.tsx" }],
            },
            { name: "README.md" },
          ])
        : Promise.resolve(),
    );
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
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_tree"
        ? Promise.resolve([{ name: "README.md" }])
        : Promise.resolve(),
    );
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
    invokeMock.mockImplementation((cmd) =>
      cmd === "explorer_read_tree"
        ? Promise.resolve([{ name: "App.tsx" }, { name: "main.tsx" }])
        : Promise.resolve(),
    );
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
      cmd === "explorer_read_tree"
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
      if (cmd === "explorer_read_tree") {
        return Promise.resolve([{ name: "App.tsx", kind: "tsx" }]);
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
      cmd === "explorer_read_tree"
        ? Promise.resolve([
            { name: "src", children: [{ name: "main.rs" }] },
            { name: "README.md" },
          ])
        : Promise.resolve(),
    );
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");

    expect(invokeMock).toHaveBeenCalledWith("explorer_read_tree", {
      root: "/Users/dev/projects/storefront",
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
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "explorer_read_tree") {
        // Zwei Dateien, weil der Verlassen-Guard aus Ticket 05 ein ZIEL
        // braucht: „Wechsel auf eine andere Datei" ist ohne zweite Zeile im
        // Baum nicht auslösbar.
        return Promise.resolve([
          { name: "src", children: [{ name: "main.rs" }] },
          { name: "README.md" },
        ]);
      }
      if (cmd === "explorer_read_file") return readFile();
      if (cmd === "explorer_write_file") return writeFile();
      return Promise.resolve();
    });
    render(<App />);

    clickPicker();
    await screen.findByLabelText("Terminal storefront");
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
      expect(invokeMock).toHaveBeenCalledWith("explorer_read_tree", {
        root: "/Users/dev/projects/storefront",
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
      screen.getByRole("button", { name: /main\.rs,\s*ungespeichert/ }),
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
      screen.getByRole("button", { name: /main\.rs,\s*ungespeichert/ }),
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
      screen.getByRole("button", { name: /main\.rs,\s*ungespeichert/ }),
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

    fireEvent.click(
      screen.getByRole("button", { name: /main\.rs,\s*ungespeichert/ }),
    );

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
    const paneId = (spawnCall?.[1] as { paneId: string }).paneId;

    fireEvent.click(screen.getByRole("button", { name: "Pane schließen" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("pty_kill", { paneId });
    });
    // pty_kill ist laut IPC-Vertrag nicht idempotent — genau ein Aufruf.
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "pty_kill"),
    ).toHaveLength(1);
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

  // Der wertvollste neue Fall aus Ticket 03: `paneId` kommt jetzt stabil vom
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
      screen.getByRole("button", { name: "Projekt wählen" }),
    ).toBeInTheDocument();
  });
});

// jsdom meldet keine macOS-Kennung, es gilt hier also die Strg-Belegung; dass
// beide Positionen und beide Plattformen gleich matchen, deckt registry.test.ts
// ab. Geprüft wird hier die Verdrahtung, nicht der Matcher.
describe("Zoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
    xterm.keyHandler = null;
    delete xterm.options.fontSize;
  });

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

    const fontSizeBefore = xterm.options.fontSize;
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
    expect(xterm.keyHandler?.(event as unknown as KeyboardEvent)).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(xterm.options.fontSize).toBe(fontSizeBefore);
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
      xterm.keyHandler?.(event as unknown as KeyboardEvent);
      return event.preventDefault;
    };

    const prevented = press("Equal");
    const enlarged = xterm.options.fontSize;
    press("Digit0");
    const base = xterm.options.fontSize;

    // Ohne preventDefault liefe der eingebaute Webview-Zoom auf derselben
    // Taste mit — die Pane-Schrift wüchse dann doppelt.
    expect(prevented).toHaveBeenCalled();
    expect(enlarged).toBeGreaterThan(base ?? 0);
    // fit() ist der Weg, auf dem die neue Zellengeometrie als pty_resize
    // beim Kindprozess ankommt.
    expect(xterm.fit).toHaveBeenCalled();
    // Und die Oberfläche bleibt, wo sie war.
    expect(setZoomMock.mock.calls.map(([level]) => level)).toEqual([1]);
  });
});
