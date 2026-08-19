import { render, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PtyBackendContext } from "./ptyBackend";
import { usePtyTerminal } from "./usePtyTerminal";

// Ticket 03 (snippet-trigger-system), code-review Nachtrag 2026-08-19: proves
// `://reload-snippets` re-reads the PROJECT directory (the tab's fixed start
// path), not wherever the shell has since `cd`ed to. `://init` deliberately
// uses the live, `cd`-tracked directory (it scaffolds `.panecrew/` wherever
// the user is standing) — `snippet_list` deliberately does not, since
// `.panecrew/snippets/` lives at the project root and a mid-session `cd` into
// an unrelated subdirectory must not make the project's own snippets vanish
// from the popup.
//
// The typed `://reload-snippets` input below is simulated as a real
// `InputEvent("input", { inputType: "insertText" })`, matching how
// @xterm/xterm's `CoreBrowserTerminal._inputEvent` actually listens (not
// `keydown`/`keypress`, which it uses only for control keys) — a future
// xterm major bump changing that contract would break this test in a way
// that looks like a product regression, not a test bug.
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function noop() {
  // no-op callback for the shortcut-related hook parameters this test
  // doesn't exercise
}

interface StubBackend {
  spawn: (params: {
    tabId: string;
    cwd: string;
    cols: number;
    rows: number;
    onOutput: (bytes: ArrayBuffer) => void;
  }) => Promise<void>;
  write: (tabId: string, data: Uint8Array) => void;
  resize: (tabId: string, cols: number, rows: number) => void;
  kill: (tabId: string) => void;
  detectTool: (tabId: string) => Promise<string | null>;
}

/** A stub PTY that echoes back everything written to it, like a real shell. */
function makeEchoingBackend(): StubBackend {
  let onOutput: ((bytes: ArrayBuffer) => void) | null = null;
  return {
    spawn: (params) => {
      onOutput = params.onOutput;
      return Promise.resolve();
    },
    write: (_tabId, data) => {
      onOutput?.(new Uint8Array(data).buffer);
    },
    resize: () => undefined,
    kill: () => undefined,
    detectTool: () => Promise.resolve(null),
  };
}

function Harness({ cwd }: { cwd: string }) {
  const { containerRef } = usePtyTerminal("tab-1", cwd, null, noop, noop, noop, noop, true);
  return <div ref={containerRef} />;
}

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

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    if (command === "snippet_list") return Promise.resolve([]);
    if (command === "shell_history_read") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

const settle = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

function snippetListCalls(): string[] {
  return invoke.mock.calls
    .filter((call: unknown[]) => call[0] === "snippet_list")
    .map((call: unknown[]) => (call[1] as { projectPath: string }).projectPath);
}

describe("usePtyTerminal: ://reload-snippets liest weiterhin das Projektverzeichnis", () => {
  it("bleibt nach einem `cd` in eine Unterdirectory beim Projekt-Root, nicht beim Live-cwd", async () => {
    const backend = makeEchoingBackend();
    const { container } = render(
      <PtyBackendContext.Provider value={backend}>
        <Harness cwd="/project/root" />
      </PtyBackendContext.Provider>,
    );

    await waitFor(() => expect(snippetListCalls()).toEqual(["/project/root"]));

    // Shell reports (via OSC 7) that the user `cd`ed into a subdirectory that
    // has no `.panecrew/` of its own.
    backend.write("tab-1", new TextEncoder().encode("\x1b]7;file://localhost/project/root/sub\x07"));
    await settle();

    // Types "://reload-snippets" and lets the stub backend echo it back, the
    // same way a real shell would. xterm's CoreBrowserTerminal listens for a
    // real browser "input" event with inputType "insertText" on its textarea
    // (not "keydown"/"keypress", which only cover control keys) and feeds
    // `ev.data` straight to `onData` — this mirrors that path exactly.
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("xterm textarea not found");
    textarea.dispatchEvent(
      new InputEvent("input", {
        data: "://reload-snippets",
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    await settle();

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
    );
    await settle();

    await waitFor(() => expect(snippetListCalls().length).toBeGreaterThan(1));
    expect(snippetListCalls()).toEqual(["/project/root", "/project/root"]);
  });
});
