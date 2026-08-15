import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPausedEvent,
  applySingleKillEvent,
  applyStatusEvent,
  applyTerminatedEvent,
  disposeResourceGuardEntry,
  resetResourceGuardForTests,
  useTabResourceGuard,
} from "./resourceGuard";

// Frontend-Register der Pro-Tab-Ressourcen-Eskalationskette
// (`resource_guard.rs`) — dieselbe Teststruktur wie terminalActivity.test.ts:
// die vier `apply*`-Funktionen sind exakt das, was App.tsx' Event-Listener
// aufruft (s. dortiger Kopfkommentar), der Hook ist genau das, was
// PaneTabs.tsx/TabResourceBanner.tsx tatsächlich konsumieren.

afterEach(() => {
  resetResourceGuardForTests();
});

describe("useTabResourceGuard", () => {
  it("liefert den Leerlaufzustand für einen noch nie berührten Tab", () => {
    const { result } = renderHook(() => useTabResourceGuard("tab-a"));
    expect(result.current).toEqual({
      status: "normal",
      percent: 0,
      reason: null,
      singleKillNonce: 0,
    });
  });

  it("übernimmt normal/warn 1:1 aus dem Status-Event", () => {
    const { result } = renderHook(() => useTabResourceGuard("tab-a"));
    act(() => applyStatusEvent({ tabId: "tab-a", status: "warn", percent: 27 }));
    expect(result.current).toEqual({
      status: "warn",
      percent: 27,
      reason: null,
      singleKillNonce: 0,
    });
  });

  it("wechselt bei einem Pause-Event auf paused, unabhängig vom vorigen Status", () => {
    const { result } = renderHook(() => useTabResourceGuard("tab-a"));
    act(() => applyStatusEvent({ tabId: "tab-a", status: "warn", percent: 25 }));
    act(() => applyPausedEvent({ tabId: "tab-a", percent: 44, pid: 4242 }));
    expect(result.current.status).toBe("paused");
    expect(result.current.percent).toBe(44);
  });

  it("trägt bei einem Terminated-Event den mitgelieferten Grund-Schlüssel", () => {
    const { result } = renderHook(() => useTabResourceGuard("tab-a"));
    act(() =>
      applyTerminatedEvent({
        tabId: "tab-a",
        percent: 41,
        reason: "memory-limit-exceeded-repeatedly",
      }),
    );
    expect(result.current.status).toBe("terminated");
    expect(result.current.reason).toBe("memory-limit-exceeded-repeatedly");
  });

  it("erhöht bei jedem Single-Kill-Event den Nonce und übernimmt dessen eigenen percent-Wert, ohne Status/Grund zu verändern", () => {
    const { result } = renderHook(() => useTabResourceGuard("tab-a"));
    act(() => applyStatusEvent({ tabId: "tab-a", status: "warn", percent: 30 }));
    act(() => applySingleKillEvent({ tabId: "tab-a", percent: 45 }));
    expect(result.current.status).toBe("warn");
    expect(result.current.percent).toBe(45);
    expect(result.current.singleKillNonce).toBe(1);

    act(() => applySingleKillEvent({ tabId: "tab-a", percent: 47 }));
    expect(result.current.percent).toBe(47);
    expect(result.current.singleKillNonce).toBe(2);
  });

  it("hält den Single-Kill-Nonce monoton über normal/warn/paused/terminated hinweg — keines der anderen Events setzt ihn zurück", () => {
    // Regression: `TabResourceBanner.tsx`s `mountedNonce`-Ref erkennt einen
    // zweiten Einzel-Kill nur an einem GESTIEGENEN Zähler. Würde irgendein
    // Status-/Pause-/Terminated-Event den Nonce auf 0 zurückwerfen, bliebe
    // ein zweiter Single-Kill kurz danach unsichtbar.
    const { result } = renderHook(() => useTabResourceGuard("tab-a"));
    act(() => applySingleKillEvent({ tabId: "tab-a", percent: 30 }));
    expect(result.current.singleKillNonce).toBe(1);

    act(() => applyStatusEvent({ tabId: "tab-a", status: "warn", percent: 25 }));
    expect(result.current.singleKillNonce).toBe(1);

    act(() => applyPausedEvent({ tabId: "tab-a", percent: 44, pid: 1 }));
    expect(result.current.singleKillNonce).toBe(1);

    act(() =>
      applyTerminatedEvent({ tabId: "tab-a", percent: 60, reason: "x" }),
    );
    expect(result.current.singleKillNonce).toBe(1);

    act(() => applySingleKillEvent({ tabId: "tab-a", percent: 61 }));
    expect(result.current.singleKillNonce).toBe(2);
  });

  it("hält verschiedene Tabs unabhängig auseinander", () => {
    const tabA = renderHook(() => useTabResourceGuard("tab-a"));
    const tabB = renderHook(() => useTabResourceGuard("tab-b"));
    act(() => applyPausedEvent({ tabId: "tab-a", percent: 50, pid: 1 }));
    expect(tabA.result.current.status).toBe("paused");
    expect(tabB.result.current.status).toBe("normal");
  });

  it("disposeResourceGuardEntry löscht den Eintrag — ein danach neu gemounteter Konsument derselben tabId sieht wieder den Leerlaufzustand", () => {
    // Wie `disposeTerminalActivity` (terminalActivity.ts) benachrichtigt auch
    // dies keine noch laufenden Abonnenten: es wird ausschließlich beim
    // "Neu starten"-Knopf gerufen (`TabResourceBanner.tsx`), unmittelbar
    // bevor genau dieser Tab geschlossen wird — der einzige Konsument dieser
    // tabId verschwindet im selben Zug, es gibt niemanden mehr zu
    // benachrichtigen.
    act(() =>
      applyTerminatedEvent({ tabId: "tab-a", percent: 41, reason: "x" }),
    );
    act(() => disposeResourceGuardEntry("tab-a"));

    const { result } = renderHook(() => useTabResourceGuard("tab-a"));
    expect(result.current).toEqual({
      status: "normal",
      percent: 0,
      reason: null,
      singleKillNonce: 0,
    });
  });
});
