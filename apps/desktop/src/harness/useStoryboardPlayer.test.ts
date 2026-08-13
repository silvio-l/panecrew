import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryboardPlayer } from "./useStoryboardPlayer";
import { parseStoryboard, type Storyboard } from "./storyboard";

const STORYBOARD: Storyboard = parseStoryboard({
  panes: [
    { slot: 0, projectName: "panecrew" },
    { slot: 1, projectName: "website" },
  ],
  focusEvents: [
    { atMs: 0, slot: 0 },
    { atMs: 4000, slot: 1 },
  ],
  typedEvents: [{ atMs: 500, slot: 0, text: "pnpm tauri dev" }],
});

function createHandlers() {
  const calls: string[] = [];
  const paneOf = new Map<number, { paneId: string; tabId: string }>();
  const assignPane = vi.fn((slot: number, projectName: string) => {
    const pane = { paneId: `pane-${slot}`, tabId: `tab-${slot}` };
    paneOf.set(slot, pane);
    calls.push(`assign(${slot},${projectName})`);
    return pane;
  });
  const focusPane = vi.fn((paneId: string) => {
    calls.push(`focus(${paneId})`);
  });
  const typeInto = vi.fn((tabId: string, text: string) => {
    calls.push(`type(${tabId},"${text}")`);
  });
  return { assignPane, focusPane, typeInto, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useStoryboardPlayer", () => {
  it("weist beim Mount sofort alle Storyboard-Panes zu", () => {
    const handlers = createHandlers();
    renderHook(() => {
      useStoryboardPlayer(STORYBOARD, handlers);
    });

    expect(handlers.assignPane).toHaveBeenCalledTimes(2);
    expect(handlers.calls).toEqual([
      "assign(0,panecrew)",
      "assign(1,website)",
    ]);
  });

  it("spielt Fokus- und Tipp-Events zur richtigen Zeit ab, aufgelöst über die zugewiesene Pane", () => {
    const handlers = createHandlers();
    renderHook(() => {
      useStoryboardPlayer(STORYBOARD, handlers);
    });
    handlers.calls.length = 0;

    vi.advanceTimersByTime(500);
    expect(handlers.calls).toEqual([
      "focus(pane-0)",
      'type(tab-0,"pnpm tauri dev")',
    ]);

    vi.advanceTimersByTime(3500);
    expect(handlers.calls).toEqual([
      "focus(pane-0)",
      'type(tab-0,"pnpm tauri dev")',
      "focus(pane-1)",
    ]);
  });

  it("ist deterministisch: zwei Läufe erzeugen dieselbe Aufrufreihenfolge", () => {
    const first = createHandlers();
    renderHook(() => {
      useStoryboardPlayer(STORYBOARD, first);
    });
    vi.advanceTimersByTime(4000);

    const second = createHandlers();
    renderHook(() => {
      useStoryboardPlayer(STORYBOARD, second);
    });
    vi.advanceTimersByTime(4000);

    expect(second.calls).toEqual(first.calls);
  });

  it("räumt beim Unmount ausstehende Timer auf — kein Aufruf nach dem Unmount", () => {
    const handlers = createHandlers();
    const { unmount } = renderHook(() => {
      useStoryboardPlayer(STORYBOARD, handlers);
    });
    handlers.calls.length = 0;

    unmount();
    vi.advanceTimersByTime(10_000);

    expect(handlers.calls).toEqual([]);
  });
});
