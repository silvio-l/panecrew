import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabResourceBanner } from "./TabResourceBanner";
import {
  applyPausedEvent,
  applyTerminatedEvent,
  resetResourceGuardForTests,
  useTabResourceGuard,
} from "../terminal/resourceGuard";

// `TabResourceBanner.tsx`s zwei Aufgaben, die `TerminalPane.test.tsx` (das
// echte `usePtyTerminal` mockt und den ganzen Baum aufbaut) nicht abdeckt:
// den Paused-/Terminated-Zustand rendern, und beim Unmount den eigenen
// `resourceGuard.ts`-Registereintrag wieder freigeben (das Leck, das ein
// vorheriger Review-Befund für diese Komponente UND PaneTabs.tsx' Chip
// beschrieb — hier ist der natürliche Ort, es zu schließen: die Komponente
// lebt exakt so lange wie der Tab selbst).

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  resetResourceGuardForTests();
});

describe("TabResourceBanner", () => {
  it("zeigt im Paused-Zustand Fortsetzen/Beenden, im Terminated-Zustand nur Neu starten", () => {
    applyPausedEvent({ tabId: "tab-a", percent: 44, pid: 123 });
    const { rerender } = render(
      <TabResourceBanner tabId="tab-a" onTerminate={vi.fn()} onRestart={vi.fn()} />,
    );
    expect(screen.getByText("Fortsetzen")).toBeInTheDocument();
    expect(screen.getByText("Beenden")).toBeInTheDocument();

    applyTerminatedEvent({ tabId: "tab-a", percent: 61, reason: "x" });
    rerender(<TabResourceBanner tabId="tab-a" onTerminate={vi.fn()} onRestart={vi.fn()} />);
    expect(screen.getByText("Neu starten")).toBeInTheDocument();
    expect(screen.queryByText("Fortsetzen")).not.toBeInTheDocument();
  });

  it("räumt beim Unmount den eigenen resourceGuard-Registereintrag weg", () => {
    applyTerminatedEvent({ tabId: "tab-b", percent: 55, reason: "x" });
    const { unmount } = render(
      <TabResourceBanner tabId="tab-b" onTerminate={vi.fn()} onRestart={vi.fn()} />,
    );
    unmount();

    const { result } = renderHook(() => useTabResourceGuard("tab-b"));
    expect(result.current).toEqual({
      status: "normal",
      percent: 0,
      reason: null,
      singleKillNonce: 0,
    });
  });
});
