import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { About } from "./About";

// Regressionsschutz für den rAF-Deadlock: das Über-Fenster startet unsichtbar
// (`visible(false)` in about.rs) und deckt sich erst auf, wenn das Frontend
// `about_visible` ruft. Ein unsichtbares WKWebView bekommt auf macOS keine
// reguläre requestAnimationFrame-Taktung mehr — der ursprüngliche doppelte
// rAF-Wait brauchte dadurch gemessen bis zu ~1s statt zwei Frames. Dieser Test
// hält beides fest: `about_visible` läuft ohne rAF-Vermittlung, und die
// Komponente ruft `requestAnimationFrame` überhaupt nicht mehr auf.

const getIdentifierMock = vi.fn(() => Promise.resolve("dev.panecrew.desktop"));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0.1.0"),
  getIdentifier: () => getIdentifierMock(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

const invokeMock = vi.mocked(invoke);

describe("About", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation((cmd) =>
      cmd === "about_take_update_request"
        ? Promise.resolve(false)
        : Promise.resolve(undefined),
    );
  });

  it("ruft about_visible auf, ohne auf requestAnimationFrame zu warten", async () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");

    render(<About />);

    // Bewusst kein `act`-Vorlauf über echte Frames: bleibt der Aufruf an rAF
    // hängen, findet dieser Test ihn nie und schlägt fehl, statt ihn
    // versehentlich mitzutakten.
    await screen.findByText("Version 0.1.0");
    expect(invokeMock).toHaveBeenCalledWith("about_visible");
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("zeigt das Nightly-Abzeichen nur auf dem Nightly-Kanal", async () => {
    getIdentifierMock.mockResolvedValueOnce("dev.panecrew.desktop.nightly");
    render(<About />);

    await screen.findByText("Version 0.1.0");
    expect(screen.getByText("Nightly")).toBeInTheDocument();
  });

  it("zeigt kein Nightly-Abzeichen auf dem Stable-Kanal", async () => {
    render(<About />);

    await screen.findByText("Version 0.1.0");
    expect(screen.queryByText("Nightly")).not.toBeInTheDocument();
  });
});
