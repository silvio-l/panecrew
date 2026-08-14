import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSettingsStoreForTests } from "./settingsStore";
import { useSettings, type SettingSchemaEntry } from "./useSettings";

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

const SCHEMA: SettingSchemaEntry[] = [
  {
    key: "terminal.shell",
    type: { kind: "string" },
    default: "/bin/zsh",
    description: { kind: "i18nKey", key: "settings.schema.terminal.shell.description" },
    category: "terminal",
    source: "core",
  },
  {
    key: "appearance.theme",
    type: { kind: "enum", options: ["system", "light", "dark"] },
    default: "system",
    description: { kind: "i18nKey", key: "settings.schema.appearance.theme.description" },
    category: "appearance",
    source: "core",
  },
];

beforeEach(() => {
  changedListener = null;
  // Ticket 08: `useSettings` holt seine Werte jetzt über den geteilten
  // `settingsStore.ts` statt über ein eigenes `invoke`/`listen` — dessen
  // Zwischenstand ist modulweit, würde also sonst unbemerkt aus einem
  // `it()`-Block dieser Datei in den nächsten durchsickern (jeder Test hier
  // erwartet einen frischen Fetch mit seinem eigenen Mock-Ergebnis).
  resetSettingsStoreForTests();
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd) => {
    if (cmd === "settings_get_schema") {
      return Promise.resolve(SCHEMA);
    }
    if (cmd === "settings_get_values") {
      return Promise.resolve({ "terminal.shell": "/bin/zsh", "appearance.theme": "system" });
    }
    return Promise.resolve(undefined);
  });
});

describe("useSettings", () => {
  it("lädt Schema und aufgelöste Werte", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.schema).toEqual(SCHEMA);
    expect(result.current.values).toEqual({
      "terminal.shell": "/bin/zsh",
      "appearance.theme": "system",
    });
  });

  it("fällt bei einem unvollständig gestubbten invoke (liefert undefined) auf leere Defaults zurück, statt zu crashen", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.resolve(undefined));
    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.schema).toEqual([]);
    expect(result.current.values).toEqual({});
    expect(result.current.error).toBeNull();
  });

  it("setValue aktualisiert optimistisch und feuert das richtige Kommando", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let setPromise!: Promise<void>;
    act(() => {
      setPromise = result.current.setValue("terminal.shell", "/bin/fish");
    });

    // Optimistisches Update ist synchron mit dem Aufruf sichtbar.
    expect(result.current.values["terminal.shell"]).toBe("/bin/fish");

    await act(async () => {
      await setPromise;
    });

    expect(invokeMock).toHaveBeenCalledWith("settings_set_value", {
      key: "terminal.shell",
      value: "/bin/fish",
    });
  });

  it("resetValue setzt den Wert auf den Schema-Default zurück", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setValue("terminal.shell", "/bin/fish");
    });
    await act(async () => {
      await result.current.resetValue("terminal.shell");
    });

    expect(invokeMock).toHaveBeenCalledWith("settings_reset_value", { key: "terminal.shell" });
    expect(result.current.values["terminal.shell"]).toBe("/bin/zsh");
  });

  it("ein settings:changed-Event aktualisiert nur den betroffenen Key, ohne vollständigen Reload", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    invokeMock.mockClear();
    act(() => {
      changedListener?.({ payload: { key: "appearance.theme", value: "dark" } });
    });

    expect(result.current.values["appearance.theme"]).toBe("dark");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("ein settings:changed-Event mit dem Wildcard-Key '*' lädt vollständig neu", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    invokeMock.mockClear();
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "settings_get_schema") return Promise.resolve(SCHEMA);
      if (cmd === "settings_get_values") {
        return Promise.resolve({ "terminal.shell": "/bin/bash", "appearance.theme": "light" });
      }
      return Promise.resolve(undefined);
    });

    act(() => {
      changedListener?.({ payload: { key: "*", value: null } });
    });

    await waitFor(() => expect(result.current.values["terminal.shell"]).toBe("/bin/bash"));
    expect(invokeMock).toHaveBeenCalledWith("settings_get_schema");
    expect(invokeMock).toHaveBeenCalledWith("settings_get_values");
  });
});
