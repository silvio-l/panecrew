import { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryProbe, parseOsc7 } from "./workingDirectory";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => {
  invoke.mockReset();
});

describe("parseOsc7", () => {
  it("liest Rechner und Pfad aus der Meldung der Shell", () => {
    expect(parseOsc7("file://mac.local/Users/dev/panecrew")).toEqual({
      host: "mac.local",
      path: "/Users/dev/panecrew",
    });
  });

  it("dekodiert prozentkodierte Zeichen", () => {
    expect(parseOsc7("file://mac.local/Users/dev/My%20Notes%231")?.path).toBe(
      "/Users/dev/My Notes#1",
    );
  });

  it("kommt ohne Hostnamen aus", () => {
    // Ein Kindprozess ohne gesetztes $HOST meldet den leeren Teil.
    expect(parseOsc7("file:///tmp")).toEqual({ host: "", path: "/tmp" });
  });

  it("behält den rohen Pfad, wenn die Kodierung kaputt ist", () => {
    expect(parseOsc7("file://mac.local/tmp/100%sure")?.path).toBe(
      "/tmp/100%sure",
    );
  });

  it("verwirft, was keine Verzeichnismeldung ist", () => {
    expect(parseOsc7("http://example.com/x")).toBeNull();
    expect(parseOsc7("file://mac.local")).toBeNull();
    expect(parseOsc7("")).toBeNull();
  });

  // Der Weg, auf dem die Meldung wirklich ankommt: als Escape-Sequenz im
  // PTY-Ausgabestrom, nicht als Funktionsaufruf.
  it("kommt durch xterms OSC-Verarbeitung an — mit BEL wie mit ST", async () => {
    const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    const seen: (string | undefined)[] = [];
    terminal.parser.registerOscHandler(7, (data) => {
      seen.push(parseOsc7(data)?.path);
      return true;
    });

    await new Promise<void>((resolve) => {
      terminal.write("\x1b]7;file://mac.local/tmp/a\x07", resolve);
    });
    await new Promise<void>((resolve) => {
      terminal.write("\x1b]7;file://mac.local/tmp/b\x1b\\", resolve);
    });

    expect(seen).toEqual(["/tmp/a", "/tmp/b"]);
    terminal.dispose();
  });
});

describe("createDirectoryProbe", () => {
  it("meldet erst „noch unbekannt“ und nach der Antwort das Ergebnis", async () => {
    invoke.mockResolvedValue(true);
    const onResolved = vi.fn();
    const probe = createDirectoryProbe(onResolved);

    expect(probe.isDirectory("/p", "apps")).toBeUndefined();
    await vi.waitFor(() => {
      expect(onResolved).toHaveBeenCalled();
    });

    expect(probe.isDirectory("/p", "apps")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("path_is_directory", {
      cwd: "/p",
      path: "apps",
    });
  });

  it("fragt dasselbe Ziel nur einmal", async () => {
    invoke.mockResolvedValue(false);
    const probe = createDirectoryProbe(() => undefined);

    probe.isDirectory("/p", "apps");
    probe.isDirectory("/p", "apps");
    await vi.waitFor(() => {
      expect(probe.isDirectory("/p", "apps")).toBe(false);
    });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("trennt gleiche Ziele in verschiedenen Arbeitsverzeichnissen", async () => {
    invoke.mockImplementation((_command, args) =>
      Promise.resolve((args as { cwd: string }).cwd === "/hier"),
    );
    const probe = createDirectoryProbe(() => undefined);

    probe.isDirectory("/hier", "Desktop");
    probe.isDirectory("/dort", "Desktop");
    await vi.waitFor(() => {
      expect(probe.isDirectory("/hier", "Desktop")).toBe(true);
      expect(probe.isDirectory("/dort", "Desktop")).toBe(false);
    });
  });

  it("wertet einen fehlgeschlagenen Aufruf als „kein Verzeichnis“", async () => {
    invoke.mockRejectedValue(new Error("IPC weg"));
    const probe = createDirectoryProbe(() => undefined);

    probe.isDirectory("/p", "apps");

    await vi.waitFor(() => {
      expect(probe.isDirectory("/p", "apps")).toBe(false);
    });
  });
});
