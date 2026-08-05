import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import App from "./App";

// Unter jsdom läuft weder eine Tauri-Runtime noch ein echtes xterm.js (das
// misst Zellgrößen am realen Renderer). Gemockt wird deshalb genau die
// Außengrenze: IPC-Brücke, Ordner-Dialog, Webview-Drag-Drop und xterm selbst.
// Geprüft wird damit die Verdrahtung Picker → pty_spawn; die eigentliche
// PTY-Logik ist bereits in Rust getestet, tiefere xterm-Rendering-Details
// sind hier bewusst nicht testbar.

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
  Channel: class {
    onmessage: (payload: number[]) => void = () => undefined;
  },
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => undefined)),
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
      /* no-op */
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
    attachCustomKeyEventHandler(): void {
      /* no-op */
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
const invokeMock = vi.mocked(invoke);

const clickPicker = () =>
  fireEvent.click(screen.getByRole("button", { name: "Projekt wählen" }));

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
    // Ticket 04 liefert den echten Baum — bis dahin wird nichts erfunden.
    expect(screen.getByText("Kein Dateibaum geladen.")).toBeInTheDocument();
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
