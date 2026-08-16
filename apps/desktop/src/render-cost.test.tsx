// Throwaway measurement harness for the render-cost audit question (see
// task in this session): a prior read-only audit REASONED, from reading
// PaneGrid.tsx/App.tsx, that no component in the pane-grid tree is memoized
// and that the explorer-resize drag (`setExplorerWidth` on every native
// `pointermove`) forces a full-tree reconciliation "up to hundreds of times
// per drag" — but never measured it. This file measures it, using the same
// mocking pattern as `App.test.tsx` (Tauri IPC bridge, xterm.js, WebGL
// addon) plus two `vi.mock`-wrapped, `<Profiler>`-instrumented stand-ins for
// `PaneGrid` and `TerminalPane` (the worst-case leaf: mounted once per
// terminal tab). Kept separate from `App.test.tsx` on purpose — the
// `vi.mock` calls here rewrite two production components file-wide, and that
// shouldn't leak into the other 700+ assertions there.

import { Profiler, createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "settings_get_schema") return Promise.resolve([]);
    if (cmd === "settings_get_values") return Promise.resolve({});
    return Promise.resolve();
  }),
  Channel: class {
    onmessage: (payload: number[]) => void = () => undefined;
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => undefined)),
    setZoom: vi.fn(() => Promise.resolve()),
  }),
}));

interface XtermInstance {
  options: { fontSize?: number };
  fit: ReturnType<typeof vi.fn<() => void>>;
  keyHandler: ((event: KeyboardEvent) => boolean) | null;
  dataHandler: ((data: string) => void) | null;
}

const xterm = vi.hoisted(() => {
  const instances: XtermInstance[] = [];
  return { instances };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    private instance: XtermInstance | null = null;
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
    proposeDimensions(): { cols: number; rows: number } | undefined {
      this.instance?.fit();
      return this.dimensions
        ? { cols: this.dimensions.cols, rows: this.dimensions.rows }
        : undefined;
    }
  },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss = (): { dispose: () => void } => ({ dispose: () => undefined });
    activate(): void {
      /* no-op: WebGL "succeeds" for every instance in this file */
    }
    dispose(): void {
      /* no-op */
    }
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 120;
    rows = 32;
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
    registerLinkProvider(): { dispose: () => void } {
      return { dispose: () => undefined };
    }
    parser = {
      registerOscHandler: (): { dispose: () => void } => ({
        dispose: () => undefined,
      }),
    };
  },
}));

// The two probes: `PaneGrid` (the whole grid subtree) and `TerminalPane`
// (the deepest, most-replicated leaf — one instance per terminal tab, hidden
// tabs included). Each is swapped for a wrapper that renders the real
// component inside its own `<Profiler>`, so `onRender` fires exactly when
// that component (or a descendant inside its boundary) actually commits —
// this is `React.Profiler`, not an inferred/indirect count.
const renderCounts = vi.hoisted(() => ({ paneGrid: 0, terminalPane: 0 }));

vi.mock("./components/PaneGrid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./components/PaneGrid")>();
  function InstrumentedPaneGrid(
    props: Parameters<typeof actual.PaneGrid>[0],
  ): ReturnType<typeof actual.PaneGrid> {
    return createElement(
      Profiler,
      { id: "PaneGrid", onRender: () => renderCounts.paneGrid++ },
      createElement(actual.PaneGrid, props),
    );
  }
  return { ...actual, PaneGrid: InstrumentedPaneGrid };
});

vi.mock("./components/TerminalPane", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./components/TerminalPane")>();
  function InstrumentedTerminalPane(
    props: Parameters<typeof actual.TerminalPane>[0],
  ): ReturnType<typeof actual.TerminalPane> {
    return createElement(
      Profiler,
      { id: "TerminalPane", onRender: () => renderCounts.terminalPane++ },
      createElement(actual.TerminalPane, props),
    );
  }
  return { ...actual, TerminalPane: InstrumentedTerminalPane };
});

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  xterm.instances.length = 0;
  renderCounts.paneGrid = 0;
  renderCounts.terminalPane = 0;
  vi.clearAllMocks();
  invokeMock.mockResolvedValue(undefined);
});

// Three occupied slots out of a "quad" (4-slot) grid — 2-4 panes as asked
// for, one of them (admin) with three terminal tabs, so the leaf-render
// count reflects "hidden but mounted" tabs too, not just the one visible.
const QUAD_SESSION = {
  windows: [
    {
      label: "main",
      template: "quad",
      slots: [
        {
          project_path: "/Users/dev/projects/storefront",
          terminal_tabs: [{}],
          active_tab: { kind: "terminal", index: 0 },
        },
        {
          project_path: "/Users/dev/projects/admin",
          terminal_tabs: [{}, {}, {}],
          active_tab: { kind: "terminal", index: 0 },
        },
        {
          project_path: "/Users/dev/projects/api",
          terminal_tabs: [{}],
          active_tab: { kind: "terminal", index: 0 },
        },
        null,
      ],
    },
  ],
};

const mockQuadSession = () => {
  invokeMock.mockImplementation((cmd) => {
    if (cmd === "session_load") return Promise.resolve(QUAD_SESSION);
    if (cmd === "get_launch_project") return Promise.resolve(null);
    if (cmd === "settings_get_schema") return Promise.resolve([]);
    if (cmd === "settings_get_values") return Promise.resolve({});
    return Promise.resolve();
  });
};

describe("Render-Kosten-Messung (Audit, s. Aufgabenbeschreibung dieser Session)", () => {
  it("misst PaneGrid-/TerminalPane-Commits bei einem einzelnen Pane-Fokuswechsel", async () => {
    mockQuadSession();
    render(<App />);

    await screen.findByLabelText("Terminal storefront");
    await screen.findByLabelText("Terminal api");
    // admin trägt drei Tabs -> drei gleichzeitig gemountete TerminalPane-
    // Instanzen mit demselben aria-label (s. `usePtyTerminal`-Kopfkommentar
    // in App.test.tsx).
    expect(await screen.findAllByLabelText("Terminal admin")).toHaveLength(3);

    const nextButton = screen.getByRole("button", { name: "Nächste Pane" });
    expect(nextButton).not.toBeDisabled();

    // Nullpunkt NACH dem Aufbau (drei Panes zuweisen, Tabs nachziehen löst
    // selbst mehrere Commits aus) — gemessen wird nur der eine Fokuswechsel
    // danach.
    renderCounts.paneGrid = 0;
    renderCounts.terminalPane = 0;

    fireEvent.click(nextButton);

    console.log(
      `[render-cost] Pane-Fokuswechsel (1 Klick): PaneGrid=${renderCounts.paneGrid} TerminalPane=${renderCounts.terminalPane}`,
    );

    // Regressionsschutz gegen die gemessene Baseline (PaneGrid=2,
    // TerminalPane=10): dieser Fall liegt laut Audit bereits nahe am
    // notwendigen Minimum (ein Fokuswechsel MUSS mindestens einen Commit
    // auslösen) — hier wurde bewusst NICHTS geändert (Step 2: Zahlen
    // rechtfertigen keinen Fix). Obergrenze statt reinem `toBeGreaterThan(0)`,
    // damit ein künftiger Regressions-Sprung (z. B. neue, unnötige State-
    // Updates im Fokuswechsel-Pfad) hier auffliegt.
    expect(renderCounts.paneGrid).toBeGreaterThan(0);
    expect(renderCounts.paneGrid).toBeLessThanOrEqual(2);
    expect(renderCounts.terminalPane).toBeLessThanOrEqual(10);
  });

  it("misst PaneGrid-/TerminalPane-Commits bei einem 30-Schritt-Pointermove-Drag (Explorer-Breite) und belegt, dass die Breite dabei live mitzieht", async () => {
    mockQuadSession();
    const { container } = render(<App />);

    await screen.findByLabelText("Terminal storefront");
    await screen.findAllByLabelText("Terminal admin");
    await screen.findByLabelText("Terminal api");

    const separator = screen.getByRole("separator", {
      name: "Explorer-Breite anpassen",
    });
    separator.setPointerCapture = vi.fn();

    // Der Ref-Container aus App.tsx (`explorerContainerRef`) — trägt während
    // des Drags die CSS-Custom-Property, die das <aside> per `var()` liest.
    const explorerContainer = container.querySelector<HTMLElement>(
      ".relative.flex.min-h-0.flex-1",
    );
    if (!explorerContainer) {
      throw new Error("Explorer-Container (Ref-Ziel) nicht gefunden");
    }
    const aside = container.querySelector<HTMLElement>("aside");
    if (!aside) {
      throw new Error("Explorer-<aside> nicht gefunden");
    }

    fireEvent.pointerDown(separator, { clientX: 300 });

    // Nullpunkt NACH pointerdown (das selbst schon `setResizingExplorer(true)`
    // auslöst) — gemessen wird nur die pointermove-Sequenz selbst, die
    // reale Zuggeste, die laut Audit "bis zu Hunderte Male pro Ziehvorgang"
    // `setExplorerWidth` aufrief.
    renderCounts.paneGrid = 0;
    renderCounts.terminalPane = 0;

    for (let step = 1; step <= 30; step++) {
      fireEvent.pointerMove(separator, { clientX: 300 + step });
      if (step === 10) {
        // Zwischenstand nach 10 von 30 Schritten: die Live-Override zieht bei
        // JEDEM pointermove mit (224 Startbreite + 10 = 234), nicht nur beim
        // letzten — belegt, dass die Verfolgung wirklich pro Frame passiert
        // und nicht erst am Ende einmalig gesetzt wird.
        expect(
          explorerContainer.style.getPropertyValue(
            "--pc-explorer-live-width",
          ),
        ).toBe("234px");
      }
    }

    // Direkt VOR `pointerup`: kein einziger PaneGrid-/TerminalPane-Commit für
    // die gesamte 30-Schritt-Geste — der Baum bekommt die Bewegung während
    // des Ziehens gar nicht mit, weil `explorerWidth` (React-State) während
    // des Ziehens nicht mehr committet wird, nur noch die CSS-Variable direkt
    // auf dem DOM-Knoten.
    expect(renderCounts.paneGrid).toBe(0);
    expect(renderCounts.terminalPane).toBe(0);

    // Trotzdem folgt der Explorer dem Zeiger WÄHREND des Ziehens live, nicht
    // erst beim Loslassen: mechanischer Nachweis statt `toHaveStyle`, weil
    // jsdom `var(...)` in der Style-Berechnung nicht auflöst.
    expect(
      explorerContainer.style.getPropertyValue("--pc-explorer-live-width"),
    ).toBe("254px");
    expect(aside.style.width).toBe(
      "var(--pc-explorer-live-width, 224px)",
    );

    fireEvent.pointerUp(separator);

    console.log(
      `[render-cost] 30-Schritt-Drag: PaneGrid=${renderCounts.paneGrid} TerminalPane=${renderCounts.terminalPane} (vor pointerup: 0/0)`,
    );

    // Verhaltenskontrolle: der Explorer ist tatsächlich der gezogenen Breite
    // gefolgt und committet sie beim Loslassen in echten React-State (30px
    // Bewegung, Startbreite 224px lt. App.test.tsx) — die Messung läuft also
    // gegen eine echte, wirksame Ziehgeste, nicht gegen ein no-op.
    expect(aside).toHaveStyle({ width: "254px" });

    // Regressionsschutz: GENAU ein Commit für die gesamte Geste (React
    // batcht die `setResizingExplorer`/`setExplorerWidth`/
    // `setPersistedExplorerWidth`-Aufrufe in `onUp` automatisch) — nicht mehr
    // 31 wie vor der Umstellung von `setState` pro `pointermove` auf die
    // Ref+CSS-Variable-Technik.
    expect(renderCounts.paneGrid).toBe(1);
    expect(renderCounts.terminalPane).toBe(5);
  });
});
