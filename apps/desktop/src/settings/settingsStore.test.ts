// Ticket 08 (Perf-Audit): vor diesem Ticket riefen Theme-, Sprach-, Terminal-
// und Aktivitäts-Applier sowie jeder `useSettings()`-Konsument je EIGENSTÄNDIG
// `settings_get_values` auf und abonnierten je EIGENSTÄNDIG
// `settings:changed` — ein Fenster, das alle gleichzeitig mountet, löste so
// N Roundtrips und N Listener für exakt dieselbe Antwort aus. Dieser Test
// mountet genau dieses Szenario (Theme + Sprache + Terminal-Settings +
// Aktivitäts-Applier + zwei `useSettings`-Konsumenten, wie ExplorerPanel und
// SettingsWindow ihn je einzeln nutzen) und belegt: genau ein
// `settings_get_values`-Aufruf, genau ein `settings:changed`-Listener — bei
// weiterhin korrekten, live reagierenden Werten pro Consumer.
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initLanguageApplier } from "../i18n/applyLanguage";
import { initTerminalActivitySettingsApplier } from "../terminal/applyActivitySettings";
import { initTerminalSettingsApplier } from "../theme/applyTerminalSettings";
import { initThemeApplier } from "../theme/applyTheme";
import {
  getSettingsValues,
  resetSettingsStoreForTests,
  subscribeToSettingsChanges,
} from "./settingsStore";
import { useSettings } from "./useSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

interface ChangedPayload {
  key: string;
  value: unknown;
}
type ChangedCallback = (event: { payload: ChangedPayload }) => void;

const VALUES: Record<string, unknown> = {
  "appearance.theme": "dark",
  "appearance.language": "de",
  "terminal.fontSize": 14,
  "terminal.activityIdleMs": 4000,
  "terminal.activityLineThreshold": 3,
};

function callsWith(mockFn: typeof invokeMock | typeof listenMock, arg0: string): number {
  return mockFn.mock.calls.filter((call) => call[0] === arg0).length;
}

/** Der zuletzt via `listen("settings:changed", …)` registrierte Callback —
 * bei genau einem geteilten Listener (das, was dieses Ticket herstellt) ist
 * das auch der EINZIGE. */
function lastChangedCallback(): ChangedCallback | undefined {
  const call = listenMock.mock.calls.find((candidate) => candidate[0] === "settings:changed");
  return call?.[1] as ChangedCallback | undefined;
}

beforeEach(() => {
  resetSettingsStoreForTests();
  invokeMock.mockReset();
  listenMock.mockClear();
  invokeMock.mockImplementation((cmd) => {
    if (cmd === "settings_get_schema") return Promise.resolve([]);
    if (cmd === "settings_get_values") return Promise.resolve(VALUES);
    return Promise.resolve(undefined);
  });
  document.documentElement.removeAttribute("data-theme");
  // jsdom kennt `matchMedia` nicht — `initThemeApplier` braucht es für die
  // `system`-Auflösung, der konkrete Rückgabewert ist für diese Tests
  // irrelevant (es geht um Fetch-/Listener-Anzahl, nicht ums OS-Theme).
  window.matchMedia = (query) =>
    ({
      matches: false,
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

describe("settingsStore — Store-Grundverhalten", () => {
  it("dedupliziert mehrere gleichzeitige getSettingsValues()-Aufrufe auf genau einen invoke", async () => {
    const [a, b, c] = await Promise.all([
      getSettingsValues(),
      getSettingsValues(),
      getSettingsValues(),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(callsWith(invokeMock, "settings_get_values")).toBe(1);
  });

  it("liefert bei einem späteren Aufruf den zwischengespeicherten Stand ohne erneuten invoke", async () => {
    await getSettingsValues();
    invokeMock.mockClear();

    await getSettingsValues();

    expect(callsWith(invokeMock, "settings_get_values")).toBe(0);
  });

  it("registriert nur einen settings:changed-Listener, egal wie oft subscribeToSettingsChanges aufgerufen wird", () => {
    const unsubs = [
      subscribeToSettingsChanges(() => undefined),
      subscribeToSettingsChanges(() => undefined),
      subscribeToSettingsChanges(() => undefined),
    ];

    expect(callsWith(listenMock, "settings:changed")).toBe(1);

    unsubs.forEach((unsubscribe) => unsubscribe());
  });
});

describe("settingsStore — ein Fenster mit mehreren Consumern (Ticket 08)", () => {
  it("Theme-, Sprache-, Terminal-Settings-, Aktivitäts-Applier und zwei useSettings-Konsumenten zusammen mounten: genau ein settings_get_values-Aufruf, genau ein settings:changed-Listener", async () => {
    const applierUnsubs = [
      initThemeApplier(),
      initLanguageApplier(),
      initTerminalSettingsApplier(),
      initTerminalActivitySettingsApplier(),
    ];
    // Zwei unabhängige `useSettings()`-Konsumenten im selben Fenster — genau
    // die Situation, wenn z. B. ExplorerPanel UND ein weiterer, künftiger
    // Consumer gleichzeitig mounten würden.
    const explorerLike = renderHook(() => useSettings());
    const settingsWindowLike = renderHook(() => useSettings());

    await waitFor(() => expect(explorerLike.result.current.loading).toBe(false));
    await waitFor(() => expect(settingsWindowLike.result.current.loading).toBe(false));

    // Die Kernaussage des Tickets: EIN Fetch, EIN Listener fürs ganze
    // Fenster — nicht einer pro Consumer (das wären hier sechs von jedem).
    expect(callsWith(invokeMock, "settings_get_values")).toBe(1);
    expect(callsWith(listenMock, "settings:changed")).toBe(1);

    // Trotzdem bekommt jeder Consumer den korrekten, aktuellen Wert.
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(
      document.documentElement.style.getPropertyValue("--pc-terminal-fontSize"),
    ).toBe("14px");
    expect(explorerLike.result.current.values["appearance.theme"]).toBe("dark");
    expect(settingsWindowLike.result.current.values["terminal.fontSize"]).toBe(14);

    applierUnsubs.forEach((unsubscribe) => unsubscribe());
    explorerLike.unmount();
    settingsWindowLike.unmount();
  });

  it("ein settings:changed-Event für einen einzelnen Key erreicht weiterhin jeden Consumer, ohne erneuten invoke", async () => {
    const unsubTheme = initThemeApplier();
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    invokeMock.mockClear();
    const changed = lastChangedCallback();

    act(() => {
      changed?.({ payload: { key: "appearance.theme", value: "light" } });
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(result.current.values["appearance.theme"]).toBe("light");
    expect(callsWith(invokeMock, "settings_get_values")).toBe(0);

    unsubTheme();
  });

  it("ein Wildcard-Event ('*') refetcht genau einmal geteilt und aktualisiert jeden Consumer", async () => {
    const unsubTheme = initThemeApplier();
    const unsubLanguage = initLanguageApplier();
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    invokeMock.mockClear();
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "settings_get_schema") return Promise.resolve([]);
      if (cmd === "settings_get_values") {
        return Promise.resolve({
          ...VALUES,
          "appearance.theme": "light",
          "appearance.language": "en",
        });
      }
      return Promise.resolve(undefined);
    });
    const changed = lastChangedCallback();

    act(() => {
      changed?.({ payload: { key: "*", value: null } });
    });

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    await waitFor(() => expect(result.current.values["appearance.theme"]).toBe("light"));

    // Der Wildcard-Refetch bleibt EIN geteilter `settings_get_values`-Aufruf,
    // nicht einer pro Consumer (Theme-Applier, Sprach-Applier, useSettings).
    expect(callsWith(invokeMock, "settings_get_values")).toBe(1);

    unsubTheme();
    unsubLanguage();
  });
});
