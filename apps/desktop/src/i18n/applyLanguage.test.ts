import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});

afterEach(() => {
  void i18next.changeLanguage("de");
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
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
