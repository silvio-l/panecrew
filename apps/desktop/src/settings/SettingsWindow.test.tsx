import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsWindow } from "./SettingsWindow";
import type { SettingSchemaEntry } from "./useSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

const invokeMock = vi.mocked(invoke);

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

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd) => {
    if (cmd === "settings_get_schema") return Promise.resolve(SCHEMA);
    if (cmd === "settings_get_values") {
      return Promise.resolve({ "terminal.shell": "/bin/zsh", "my-extension.retryCount": 3 });
    }
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
    expect(numberInput).toHaveAttribute("type", "number");

    fireEvent.change(numberInput, { target: { value: "5" } });
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

  it("zeigt keine Trennlinie zur Extension-Sektion, wenn keine Extension Settings registriert hat", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "settings_get_schema") return Promise.resolve([SCHEMA[0]]);
      if (cmd === "settings_get_values") return Promise.resolve({ "terminal.shell": "/bin/zsh" });
      return Promise.resolve(undefined);
    });
    render(<SettingsWindow />);

    await waitFor(() => expect(screen.queryByText(/lade/i)).not.toBeInTheDocument());
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });
});
