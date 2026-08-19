import { render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PtyBackendContext } from "./ptyBackend";
import { usePtyTerminal } from "./usePtyTerminal";

// Ticket 35: nach einem erfolgreichen Spawn tippt der Hook den gewählten
// Adapter-Befehl in die frisch gestartete Login-Shell (`adapters.ts`'
// `launchLineFor`) — genau wie ein Nutzer, der ihn selbst eintippt und
// Enter drückt. Ein voller usePtyTerminal-Render bleibt sonst unüblich
// (siehe ptyResizeFlush.test.ts' Kopfkommentar: jsdoms ResizeObserver-Stub
// macht FitAddon.fit() folgenlos) — hier geht es aber nicht um Resize,
// sondern nur um die Reihenfolge spawn→write, die sich ohne echtes Mount
// nicht beobachten lässt.
function noop() {
  // no-op callback for the shortcut-related hook parameters this test
  // doesn't exercise
}

// Eigene, methodfreie Typform statt `PtyBackend` selbst (dessen
// Methoden-Kurzschrift-Signaturen lösen sonst ESLints `unbound-method`
// aus, sobald `backend.write` unten als bloßer Wert an `expect()` geht).
interface StubBackend {
  spawn: (params: {
    tabId: string;
    cwd: string;
    cols: number;
    rows: number;
    onOutput: (bytes: ArrayBuffer) => void;
  }) => Promise<void>;
  write: ReturnType<typeof vi.fn<(tabId: string, data: Uint8Array) => void>>;
  resize: (tabId: string, cols: number, rows: number) => void;
  kill: (tabId: string) => void;
  detectTool: (tabId: string) => Promise<string | null>;
}

function makeStubBackend(): StubBackend {
  return {
    spawn: () => Promise.resolve(),
    write: vi.fn<(tabId: string, data: Uint8Array) => void>(),
    resize: () => undefined,
    kill: () => undefined,
    detectTool: () => Promise.resolve(null),
  };
}

function Harness({ adapterId }: { adapterId: string | null }) {
  const { containerRef } = usePtyTerminal(
    "tab-1",
    "/tmp/project",
    adapterId,
    noop,
    noop,
    noop,
    noop,
    true,
  );
  return <div ref={containerRef} />;
}

// xterm fragt beim Öffnen das Device-Pixel-Ratio über eine Media Query ab;
// jsdom hat matchMedia nicht (wie in ptyResizeFlush.test.ts).
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

describe("usePtyTerminal: Adapter-Startbefehl nach dem Spawn (Ticket 35)", () => {
  it("tippt den Adapter-Befehl erst, nachdem der Spawn aufgelöst hat", async () => {
    const backend = makeStubBackend();
    render(
      <PtyBackendContext.Provider value={backend}>
        <Harness adapterId="claude" /> {/* brandlint-ok: canonical adapter id, functional */}
      </PtyBackendContext.Provider>,
    );

    await waitFor(() => expect(backend.write).toHaveBeenCalled());

    expect(backend.write).toHaveBeenCalledWith(
      "tab-1",
      new TextEncoder().encode("claude\r"), // brandlint-ok: canonical adapter id, functional
    );
  });

  it("schreibt nichts, wenn keine Adapter gewählt ist (eingebaute Shell)", async () => {
    const backend = makeStubBackend();
    render(
      <PtyBackendContext.Provider value={backend}>
        <Harness adapterId={null} />
      </PtyBackendContext.Provider>,
    );

    // Kein Adapter-Schreiben zu erwarten -- der Spawn selbst löst trotzdem
    // auf, ansonsten gäbe es nichts abzuwarten, das den Test verlässlich
    // nach dem Effekt-Durchlauf laufen lässt.
    await waitFor(() => expect(backend.spawn).toBeTruthy());
    await Promise.resolve();
    await Promise.resolve();

    expect(backend.write).not.toHaveBeenCalled();
  });

  it("fällt für eine unbekannte/veraltete Adapter-Id auf die Shell zurück, statt zu schreiben", async () => {
    const backend = makeStubBackend();
    render(
      <PtyBackendContext.Provider value={backend}>
        <Harness adapterId="some-removed-tool" />
      </PtyBackendContext.Provider>,
    );

    await waitFor(() => expect(backend.spawn).toBeTruthy());
    await Promise.resolve();
    await Promise.resolve();

    expect(backend.write).not.toHaveBeenCalled();
  });
});
