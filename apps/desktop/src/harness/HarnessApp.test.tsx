import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { HarnessApp } from "./HarnessApp";

// Dieselbe Außengrenze wie App.test.tsx: unter jsdom gibt es weder eine
// Tauri-Runtime noch ein echtes xterm.js. Der entscheidende Unterschied zum
// dortigen Mock: `invokeMock` bleibt hier über den GANZEN Lauf unangetastet
// von "pty_spawn" — genau das ist Ticket 01s Kernaussage ("ohne ein echtes
// PTY-Backend zu starten"), der Demo-Harness bindet TerminalPane über den
// Kontext aus `terminal/ptyBackend.ts` an `demoPtyBackend.ts` statt an Tauris
// IPC-Brücke.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
  Channel: class {
    onmessage: (payload: number[]) => void = () => undefined;
  },
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => undefined)),
    setZoom: vi.fn(() => Promise.resolve()),
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

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    readonly onContextLoss = (): { dispose: () => void } => ({
      dispose: () => undefined,
    });
    activate(): void {
      throw new Error("WebGL2 not supported null");
    }
    dispose(): void {
      /* no-op */
    }
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
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

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("HarnessApp", () => {
  it("mountet die echte Titelleiste und mindestens eine Test-Pane mit sichtbarem Inhalt, ohne pty_spawn zu rufen", () => {
    render(<HarnessApp />);

    expect(
      screen.getByRole("banner", { name: /title bar|titelzeile/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /panecrew/i }),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    for (const call of invokeMock.mock.calls) {
      expect(call[0]).not.toBe("pty_spawn");
    }
  });

  it("folgt den Storyboard-Fokuswechseln: die zweite Pane wird nach ihrem Fokus-Event zur aktiven", () => {
    render(<HarnessApp />);
    // Das "atMs: 0"-Fokus-Event feuert selbst über einen (Fake-)Timer-Tick,
    // nicht synchron beim Mount — ohne diesen Tick stünde der Fokus noch auf
    // der zuletzt zugewiesenen Pane (`assignProjectToSlot` fokussiert immer
    // die gerade erzeugte), nicht auf der vom Storyboard gemeinten ersten.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const panecrewPane = screen.getByRole("region", { name: /panecrew/i });
    expect(panecrewPane).toHaveAttribute("aria-current", "true");

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    const websitePane = screen.getByRole("region", { name: /website/i });
    expect(websitePane).toHaveAttribute("aria-current", "true");
    expect(panecrewPane).not.toHaveAttribute("aria-current");
  });

  it("rührt über eine volle Wiedergabe hinweg nie das dekorative Suchfeld oder das Zahnrad an", () => {
    render(<HarnessApp />);
    const gear = screen.getByRole("button", {
      name: /einstellungen|settings/i,
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(gear).not.toHaveFocus();
  });
});
