import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSettingsStoreForTests } from "../settings/settingsStore";
import i18next from "./index";
import { initLanguageApplier } from "./applyLanguage";

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

beforeEach(() => {
  changedListener = null;
  invokeMock.mockReset();
  // Ticket 08: `initLanguageApplier` holt seine Werte jetzt über den
  // geteilten `settingsStore.ts` statt über ein eigenes `invoke`/`listen` —
  // ohne Reset würde jeder Test hier den zwischengespeicherten Stand des
  // vorherigen wiederverwenden, statt wie zuvor frisch zu fetchen.
  resetSettingsStoreForTests();
});

afterEach(() => {
  void i18next.changeLanguage("de");
});

// Ticket 08: `initLanguageApplier` hängt jetzt hinter `settingsStore.ts`s
// eigener Async-Kette (`fetchValues()` plus `.finally()` plus `.then()`,
// s. settingsStore.ts) statt eines einzelnen `invoke(...).then(...)` — mehr
// Mikrotask-Hops als die alten zwei `Promise.resolve()`-Ticks abdeckten. Ein
// echter Makrotask-Tick drainiert stattdessen zuverlässig JEDE ausstehende
// Mikrotask-Kette, ganz ohne deren genaue Tiefe mitzuzählen.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("initLanguageApplier", () => {
  it("wendet die Backend-Sprache beim Start an", async () => {
    invokeMock.mockResolvedValue({ "appearance.language": "en" });

    initLanguageApplier();
    await flush();

    expect(i18next.language).toBe("en");
  });

  it("ignoriert einen unbekannten Sprachwert und bleibt beim aktuellen Stand", async () => {
    invokeMock.mockResolvedValue({ "appearance.language": "fr" });

    initLanguageApplier();
    await flush();

    expect(i18next.language).toBe("de");
  });

  it("ein settings:changed für appearance.language wirkt sofort", async () => {
    invokeMock.mockResolvedValue({ "appearance.language": "de" });
    initLanguageApplier();
    await flush();
    expect(i18next.language).toBe("de");

    changedListener?.({ payload: { key: "appearance.language", value: "en" } });

    expect(i18next.language).toBe("en");
  });

  it("ein Wildcard-Reset (\"*\") liest den Wert erneut vom Backend", async () => {
    invokeMock.mockResolvedValue({ "appearance.language": "de" });
    initLanguageApplier();
    await flush();

    invokeMock.mockResolvedValue({ "appearance.language": "en" });
    changedListener?.({ payload: { key: "*", value: null } });
    await flush();

    expect(i18next.language).toBe("en");
  });
});
