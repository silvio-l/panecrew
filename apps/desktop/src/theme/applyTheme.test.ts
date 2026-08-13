import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initThemeApplier } from "./applyTheme";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let changedListener: ((event: { payload: { key: string; value: unknown } }) => void) | null =
  null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_event: string, callback: (event: { payload: { key: string; value: unknown } }) => void) => {
    changedListener = callback;
    return Promise.resolve(() => {
      changedListener = null;
    });
  },
}));

const invokeMock = vi.mocked(invoke);

// Kontrollierbare jsdom-Attrappe (jsdom hat matchMedia nicht), analog
// `inlineSuggestion.test.ts` — mit Registrierung/Auslösung der
// `change`-Listener, weil dieser Test genau das prüft.
let systemPrefersLight = false;
let mediaListeners: (() => void)[] = [];

beforeEach(() => {
  changedListener = null;
  mediaListeners = [];
  systemPrefersLight = false;
  document.documentElement.removeAttribute("data-theme");
  window.matchMedia = (query) =>
    ({
      get matches() {
        return systemPrefersLight;
      },
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_type: string, listener: () => void) => {
        mediaListeners.push(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        mediaListeners = mediaListeners.filter((candidate) => candidate !== listener);
      },
    }) as unknown as MediaQueryList;
  invokeMock.mockReset();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("initThemeApplier", () => {
  it("löst 'system' beim Start gegen prefers-color-scheme auf (dunkel)", async () => {
    systemPrefersLight = false;
    invokeMock.mockResolvedValue({ "appearance.theme": "system" });

    initThemeApplier();
    await flush();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("löst 'system' beim Start gegen prefers-color-scheme auf (hell)", async () => {
    systemPrefersLight = true;
    invokeMock.mockResolvedValue({ "appearance.theme": "system" });

    initThemeApplier();
    await flush();

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("wendet eine explizite Wahl direkt an, unabhängig vom OS-Zustand", async () => {
    systemPrefersLight = false;
    invokeMock.mockResolvedValue({ "appearance.theme": "light" });

    initThemeApplier();
    await flush();

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ein settings:changed für appearance.theme wirkt sofort", async () => {
    invokeMock.mockResolvedValue({ "appearance.theme": "dark" });
    initThemeApplier();
    await flush();
    expect(document.documentElement.dataset.theme).toBe("dark");

    changedListener?.({ payload: { key: "appearance.theme", value: "light" } });

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ein OS-Wechsel wirkt live nach, solange 'system' aktiv ist", async () => {
    systemPrefersLight = false;
    invokeMock.mockResolvedValue({ "appearance.theme": "system" });
    initThemeApplier();
    await flush();
    expect(document.documentElement.dataset.theme).toBe("dark");

    systemPrefersLight = true;
    mediaListeners.forEach((listener) => listener());

    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
