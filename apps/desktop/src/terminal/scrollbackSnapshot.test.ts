import { Terminal } from "@xterm/xterm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureSnapshot, hydrateSnapshot } from "./scrollbackSnapshot";

function makeTerminal(options?: ConstructorParameters<typeof Terminal>[0]): Terminal {
  const container = document.createElement("div");
  document.body.append(container);
  const terminal = new Terminal({ cols: 80, rows: 10, allowProposedApi: true, ...options });
  terminal.open(container);
  return terminal;
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function visibleLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < terminal.rows; y += 1) {
    lines.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? "");
  }
  return lines;
}

// Same jsdom gap as ptyResizeFlush.test.ts: xterm queries devicePixelRatio via
// a media query on open(), which jsdom doesn't implement.
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

describe("scrollback snapshot capture/hydrate", () => {
  it("hydrates a fresh terminal with the same visible content that was captured", async () => {
    const source = makeTerminal();
    await write(source, "line one\r\nline two\r\nline three");

    const snapshot = captureSnapshot(source);

    const target = makeTerminal();
    await hydrateSnapshot(target, snapshot);

    expect(visibleLines(target)).toEqual(visibleLines(source));
  });

  it("caps the snapshot at the terminal's own configured scrollback, not unbounded", async () => {
    // 5 rows viewport, scrollback capped to 3 — 20 written lines should leave
    // only the most recent ~8 (3 scrollback + 5 viewport) reachable, never
    // the very first one.
    const source = makeTerminal({ rows: 5, scrollback: 3 });
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    await write(source, lines.join("\r\n"));

    const snapshot = captureSnapshot(source);

    expect(snapshot).not.toContain("line-0\r\n");
    expect(snapshot).toContain("line-19");
  });

  it("defaults to xterm's own scrollback default (1000) when none is configured", () => {
    const source = makeTerminal();
    expect(source.options.scrollback).toBe(1000);
    // Capturing must not throw when relying on that default.
    expect(() => captureSnapshot(source)).not.toThrow();
  });
});
