import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FocusRotation,
  ROTATION_INTERVALS_MS,
  useFocusRotation,
} from "./useFocusRotation";

type Props = Parameters<typeof useFocusRotation>[0];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const THREE_SINGLE_TAB_PANES = [
  { paneId: "pane-a", tabIds: ["pane-a:tab-1"] },
  { paneId: "pane-b", tabIds: ["pane-b:tab-1"] },
  { paneId: "pane-c", tabIds: ["pane-c:tab-1"] },
];

// Explizite Generics statt einer Typannotation am Callback-Parameter: nur so
// bleibt `onConfigChange` im `Props`-Typ, den `rerender` erwartet, wirklich
// optional — sonst leitet TypeScript den Typ aus der tatsächlichen
// `initialProps`-Literal-Form ab, die das Feld belegt, und macht es dadurch
// für JEDEN `rerender`-Aufruf in diesem Test verpflichtend.
function setup(overrides: Partial<Props> = {}) {
  const onRotate = vi.fn();
  const onConfigChange = vi.fn();
  const { result, rerender } = renderHook<FocusRotation, Props>(
    (props) => useFocusRotation(props),
    {
      initialProps: {
        maximizedPaneId: "pane-a",
        activeTabId: "pane-a:tab-1",
        occupiedPanesInOrder: THREE_SINGLE_TAB_PANES,
        onRotate,
        onConfigChange,
        ...overrides,
      },
    },
  );
  return { result, rerender, onRotate, onConfigChange };
}

describe("useFocusRotation", () => {
  it("startet inaktiv mit dem Default-Intervall", () => {
    const { result } = setup();
    expect(result.current.active).toBe(false);
    expect(result.current.intervalMs).toBe(8000);
  });

  it("rotiert nach Aktivierung reihum durch die belegten Panes, beginnend bei der maximierten", () => {
    // `App.tsx`s echte Verdrahtung reicht `onRotate`s Ergebnis über
    // `enterFocusMode`/`switchToTerminalTab` als neue
    // `maximizedPaneId`/`activeTabId`-Props zurück in den Hook — der Test
    // simuliert genau das per `rerender`, statt (falsch) anzunehmen, der
    // Hook hielte den Rotationsfortschritt selbst.
    const onRotate = vi.fn();
    const { result, rerender } = renderHook<FocusRotation, Props>(
      (props) => useFocusRotation(props),
      {
        initialProps: {
          maximizedPaneId: "pane-a",
          activeTabId: "pane-a:tab-1",
          occupiedPanesInOrder: THREE_SINGLE_TAB_PANES,
          onRotate,
        },
      },
    );
    act(() => {
      result.current.toggle();
    });
    expect(result.current.active).toBe(true);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(onRotate).toHaveBeenNthCalledWith(1, { paneId: "pane-b", tabId: "pane-b:tab-1" });
    rerender({
      maximizedPaneId: "pane-b",
      activeTabId: "pane-b:tab-1",
      occupiedPanesInOrder: THREE_SINGLE_TAB_PANES,
      onRotate,
    });

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(onRotate).toHaveBeenNthCalledWith(2, { paneId: "pane-c", tabId: "pane-c:tab-1" });
    rerender({
      maximizedPaneId: "pane-c",
      activeTabId: "pane-c:tab-1",
      occupiedPanesInOrder: THREE_SINGLE_TAB_PANES,
      onRotate,
    });

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(onRotate).toHaveBeenNthCalledWith(3, { paneId: "pane-a", tabId: "pane-a:tab-1" });
  });

  it("durchläuft innerhalb EINER Pane erst alle ihre Tabs, bevor sie zur nächsten Pane weiterschaltet", () => {
    const onRotate = vi.fn();
    const panes = [
      { paneId: "pane-a", tabIds: ["pane-a:tab-1", "pane-a:tab-2"] },
      { paneId: "pane-b", tabIds: ["pane-b:tab-1"] },
    ];
    const { result, rerender } = renderHook<FocusRotation, Props>(
      (props) => useFocusRotation(props),
      {
        initialProps: {
          maximizedPaneId: "pane-a",
          activeTabId: "pane-a:tab-1",
          occupiedPanesInOrder: panes,
          onRotate,
        },
      },
    );
    act(() => {
      result.current.toggle();
    });

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(onRotate).toHaveBeenNthCalledWith(1, { paneId: "pane-a", tabId: "pane-a:tab-2" });
    rerender({
      maximizedPaneId: "pane-a",
      activeTabId: "pane-a:tab-2",
      occupiedPanesInOrder: panes,
      onRotate,
    });

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(onRotate).toHaveBeenNthCalledWith(2, { paneId: "pane-b", tabId: "pane-b:tab-1" });
  });

  it("rotiert auch mit nur einer belegten Pane, solange sie mindestens zwei Tabs hat", () => {
    const onRotate = vi.fn();
    const panes = [{ paneId: "pane-a", tabIds: ["pane-a:tab-1", "pane-a:tab-2"] }];
    const { result } = setup({
      occupiedPanesInOrder: panes,
      onRotate,
      activeTabId: "pane-a:tab-1",
    });
    act(() => {
      result.current.toggle();
    });

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(onRotate).toHaveBeenCalledWith({ paneId: "pane-a", tabId: "pane-a:tab-2" });
  });

  it("cycleInterval schaltet reihum durch ROTATION_INTERVALS_MS, startend beim Default", () => {
    const { result } = setup();
    const startIndex = ROTATION_INTERVALS_MS.indexOf(result.current.intervalMs);
    // Vom Default aus einmal komplett rundum, zurück zum Ausgangswert.
    for (let step = 1; step <= ROTATION_INTERVALS_MS.length; step += 1) {
      act(() => {
        result.current.cycleInterval();
      });
      const expected =
        ROTATION_INTERVALS_MS[(startIndex + step) % ROTATION_INTERVALS_MS.length];
      expect(result.current.intervalMs).toBe(expected);
    }
  });

  it("notifyInput stoppt eine laufende Rotation, statt sie nur auszusetzen", () => {
    const { result, onRotate } = setup();
    act(() => {
      result.current.toggle();
    });
    act(() => {
      result.current.notifyInput();
    });
    expect(result.current.active).toBe(false);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRotate).not.toHaveBeenCalled();
  });

  it("deaktiviert sich, wenn der Fokus-Modus verlassen wird (maximizedPaneId -> null)", () => {
    const { result, rerender, onRotate } = setup();
    act(() => {
      result.current.toggle();
    });
    expect(result.current.active).toBe(true);

    rerender({
      maximizedPaneId: null,
      activeTabId: null,
      occupiedPanesInOrder: THREE_SINGLE_TAB_PANES,
      onRotate,
    });
    expect(result.current.active).toBe(false);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRotate).not.toHaveBeenCalled();
  });

  it("springt beim erneuten Fokus-Modus-Eintritt nicht überraschend wieder an", () => {
    const { result, rerender, onRotate } = setup();
    act(() => {
      result.current.toggle();
    });

    rerender({
      maximizedPaneId: null,
      activeTabId: null,
      occupiedPanesInOrder: THREE_SINGLE_TAB_PANES,
      onRotate,
    });
    rerender({
      maximizedPaneId: "pane-b",
      activeTabId: "pane-b:tab-1",
      occupiedPanesInOrder: THREE_SINGLE_TAB_PANES,
      onRotate,
    });

    expect(result.current.active).toBe(false);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRotate).not.toHaveBeenCalled();
  });

  it("meldet jede Änderung an active/intervalMs über onConfigChange", () => {
    const { result, onConfigChange } = setup();
    onConfigChange.mockClear();

    act(() => {
      result.current.toggle();
    });
    expect(onConfigChange).toHaveBeenLastCalledWith({
      active: true,
      intervalMs: 8000,
    });

    act(() => {
      result.current.cycleInterval();
    });
    expect(onConfigChange).toHaveBeenLastCalledWith({
      active: true,
      intervalMs: 15000,
    });
  });

  it("remainingMs zählt bei aktiver Rotation sichtbar bis auf 0 herunter", () => {
    const { result } = setup();
    expect(result.current.remainingMs).toBe(8000);

    act(() => {
      result.current.toggle();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.remainingMs).toBe(5000);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.remainingMs).toBe(0);
  });

  it("remainingMs startet nach einem Rotationsschritt wieder beim vollen Intervall", () => {
    // Simuliert `App.tsx`s echte Verdrahtung wie der "rotiert nach
    // Aktivierung..."-Test oben: `onRotate`s Ergebnis kommt als neue
    // `maximizedPaneId`/`activeTabId`-Props zurück, was den Rotations-Effekt
    // (und damit auch den Countdown-Anker) frisch aufsetzt.
    const onRotate = vi.fn();
    const { result, rerender } = renderHook<FocusRotation, Props>(
      (props) => useFocusRotation(props),
      {
        initialProps: {
          maximizedPaneId: "pane-a",
          activeTabId: "pane-a:tab-1",
          occupiedPanesInOrder: THREE_SINGLE_TAB_PANES,
          onRotate,
        },
      },
    );
    act(() => {
      result.current.toggle();
    });
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    rerender({
      maximizedPaneId: "pane-b",
      activeTabId: "pane-b:tab-1",
      occupiedPanesInOrder: THREE_SINGLE_TAB_PANES,
      onRotate,
    });
    expect(result.current.remainingMs).toBe(8000);
  });

  it("remainingMs springt beim Stoppen zurück auf das volle Intervall", () => {
    const { result } = setup();
    act(() => {
      result.current.toggle();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.remainingMs).toBe(5000);

    act(() => {
      result.current.notifyInput();
    });
    expect(result.current.remainingMs).toBe(8000);
  });

  it("rotiert nicht mit einer einzelnen Pane mit nur einem Tab", () => {
    const { result, onRotate } = setup({
      occupiedPanesInOrder: [{ paneId: "pane-a", tabIds: ["pane-a:tab-1"] }],
    });
    act(() => {
      result.current.toggle();
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRotate).not.toHaveBeenCalled();
  });
});
