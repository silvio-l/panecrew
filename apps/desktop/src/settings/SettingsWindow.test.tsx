import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetOnboardingStoreForTests } from "../onboarding/onboarding";
import { resetSettingsStoreForTests } from "./settingsStore";
import { SettingsWindow } from "./SettingsWindow";
import type { SettingSchemaEntry } from "./useSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

const invokeMock = vi.mocked(invoke);
const openUrlMock = vi.mocked(openUrl);

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
}

// "my-extension" registriert sich hier so, wie `config_manifest.rs`
// (Ticket 08) einen Manifest-Beitrag in Registry-Einträge übersetzt — Ticket
// 09 baut auf genau dieser Form auf, ohne einen echten Extension-Host zu
// brauchen.
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
    key: "my-extension.retryCount",
    type: { kind: "number" },
    default: 3,
    description: { kind: "literal", text: "How many times to retry the request." },
    category: "my-extension",
    source: "my-extension",
  },
];

const ORIGINAL_USER_AGENT = window.navigator.userAgent;

beforeEach(() => {
  invokeMock.mockReset();
  openUrlMock.mockClear();
  // Ticket 08: `useSettings` holt seine Werte jetzt über den geteilten
  // `settingsStore.ts` — dessen Zwischenstand ist modulweit und würde ohne
  // Reset unbemerkt aus einem Test in den nächsten durchsickern.
  resetSettingsStoreForTests();
  // Derselbe Grund wie oben, für den geteilten Onboarding-Store.
  resetOnboardingStoreForTests();
  setUserAgent(ORIGINAL_USER_AGENT);
  invokeMock.mockImplementation((cmd) => {
    if (cmd === "settings_get_schema") return Promise.resolve(SCHEMA);
    if (cmd === "settings_get_values") {
      return Promise.resolve({ "terminal.shell": "/bin/zsh", "my-extension.retryCount": 3 });
    }
    if (cmd === "onboarding_get_state") return Promise.resolve({ completed: true });
    return Promise.resolve(undefined);
  });
});

describe("SettingsWindow — Reveal-Gate (Perf-Fix)", () => {
  // Regressionsschutz, gleiches Muster wie About.test.tsx: das Fenster startet
  // unsichtbar (`visible(false)` in settings_window.rs) und deckt sich erst
  // auf, wenn das Frontend `settings_visible` ruft — VOR dem Laden von
  // Schema/Werten, da Kategoriebaum + "Lade..."-Text schon beim Mount stehen.
  // KEIN requestAnimationFrame: ein unsichtbares WKWebView bekommt auf macOS
  // keine reguläre rAF-Taktung mehr (siehe About.tsx).
  it("ruft settings_visible beim Mount auf, ohne auf requestAnimationFrame zu warten", async () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");

    render(<SettingsWindow />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("settings_visible"));
    expect(rafSpy).not.toHaveBeenCalled();
  });
});

describe("SettingsWindow — Extension-Settings (Ticket 09)", () => {
  it("zeigt die Extension-Kategorie unter ihrer eigenen ID im Kategoriebaum", async () => {
    render(<SettingsWindow />);

    await waitFor(() => expect(screen.getByText("my-extension")).toBeInTheDocument());
  });

  it("zeigt Extension-Settings mit denselben Kontrollen und der Reset-Aktion wie Core-Settings", async () => {
    render(<SettingsWindow />);
    await waitFor(() => expect(screen.getByText("my-extension")).toBeInTheDocument());

    fireEvent.click(screen.getByText("my-extension"));

    const numberInput = await screen.findByDisplayValue("3");
    // `type="text"` statt `type="number"`: WKWebView akzeptiert in einem
    // nativen number-Feld nur "." als Dezimaltrennzeichen, unabhängig von
    // OS-/App-Sprache — s. Kommentar an `NumberSettingInput` in
    // SettingsWindow.tsx.
    expect(numberInput).toHaveAttribute("type", "text");

    fireEvent.change(numberInput, { target: { value: "5" } });
    fireEvent.blur(numberInput);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("settings_set_value", {
        key: "my-extension.retryCount",
        value: 5,
      }),
    );

    const resetButton = screen.getByRole("button", { name: /Retry Count/i });
    expect(resetButton).not.toBeDisabled();
  });

  it("findet Extension-Settings über die Suche genauso wie Core-Settings", async () => {
    render(<SettingsWindow />);
    await waitFor(() => expect(screen.getByText("my-extension")).toBeInTheDocument());

    const search = screen.getByRole("textbox", { name: /suche|search/i });
    fireEvent.change(search, { target: { value: "retry" } });

    expect(await screen.findByDisplayValue("3")).toBeInTheDocument();
  });

  it("zeigt genau eine Trennlinie (vor der Hilfe-Kategorie), wenn keine Extension Settings registriert hat", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "settings_get_schema") return Promise.resolve([SCHEMA[0]]);
      if (cmd === "settings_get_values") return Promise.resolve({ "terminal.shell": "/bin/zsh" });
      return Promise.resolve(undefined);
    });
    render(<SettingsWindow />);

    await waitFor(() => expect(screen.queryByText(/lade/i)).not.toBeInTheDocument());
    // Keine Extension-Trennlinie (keine Extension registriert), aber die
    // statische Trennlinie vor der immer vorhandenen Hilfe-Kategorie bleibt.
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });
});

describe("SettingsWindow — Hilfe-Kategorie (Onboarding-Neustart + macOS-Berechtigungen)", () => {
  it("setzt den Onboarding-Stand über den Neustart-Button zurück und zeigt danach eine Bestätigung", async () => {
    render(<SettingsWindow />);
    fireEvent.click(await screen.findByRole("button", { name: "Hilfe" }));

    fireEvent.click(await screen.findByRole("button", { name: "Einführung neu starten" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("onboarding_restart"));
    expect(
      await screen.findByText(
        "Zurückgesetzt — wechsle ins Hauptfenster, dort startet die Einführung erneut.",
      ),
    ).toBeInTheDocument();
  });

  it("zeigt den macOS-Berechtigungsabschnitt nur auf macOS", async () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    render(<SettingsWindow />);

    fireEvent.click(await screen.findByRole("button", { name: "Hilfe" }));

    expect(screen.queryByText("Berechtigungen (macOS)")).not.toBeInTheDocument();
  });

  it("öffnet auf macOS die Systemeinstellungen-URL für Vollzugriff über den Deep-Link-Button", async () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    render(<SettingsWindow />);
    fireEvent.click(await screen.findByRole("button", { name: "Hilfe" }));
    expect(await screen.findByText("Berechtigungen (macOS)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Vollständiger Festplattenzugriff/ }));
    expect(openUrlMock).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    );
  });
});
