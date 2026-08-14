import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSettingsStoreForTests } from "../settings/settingsStore";
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
  // Ticket 08: `initThemeApplier` holt seine Werte jetzt über den geteilten
  // `settingsStore.ts` statt über ein eigenes `invoke`/`listen` — ohne
  // Reset würde jeder Test hier den zwischengespeicherten Stand (und den
  // bereits registrierten Listener) des vorherigen wiederverwenden, statt
  // wie zuvor frisch zu fetchen.
  resetSettingsStoreForTests();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

// Ticket 08: `initThemeApplier` hängt jetzt hinter `settingsStore.ts`s
// eigener Async-Kette (`fetchValues()` plus `.finally()` plus `.then()`,
// s. settingsStore.ts) statt eines einzelnen `invoke(...).then(...)` — mehr
// Mikrotask-Hops als die alten zwei `Promise.resolve()`-Ticks abdeckten. Ein
// echter Makrotask-Tick drainiert stattdessen zuverlässig JEDE ausstehende
// Mikrotask-Kette, ganz ohne deren genaue Tiefe mitzuzählen.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
