import { describe, expect, it, vi } from "vitest";
import { createDemoPtyBackend } from "./demoPtyBackend";

describe("createDemoPtyBackend", () => {
  it("löst spawn auf, ohne einen echten Prozess zu starten", async () => {
    const backend = createDemoPtyBackend();
    const onOutput = vi.fn();

    await expect(
      backend.spawn({
        tabId: "tab-1",
        cwd: "/demo/project",
        cols: 80,
        rows: 24,
        onOutput,
      }),
    ).resolves.toBeUndefined();
    expect(onOutput).not.toHaveBeenCalled();
  });

  it("emit schreibt Text als einen Block an den Output-Callback des gespawnten Tabs", async () => {
    const backend = createDemoPtyBackend();
    const onOutput = vi.fn();
    await backend.spawn({
      tabId: "tab-1",
      cwd: "/demo/project",
      cols: 80,
      rows: 24,
      onOutput,
    });

    backend.emit("tab-1", "$ pnpm tauri dev");

    expect(onOutput).toHaveBeenCalledTimes(1);
    const [bytes] = onOutput.mock.calls[0] as [ArrayBuffer];
    expect(new TextDecoder().decode(bytes)).toBe("$ pnpm tauri dev");
  });

  it("emit ist ein No-Op für einen unbekannten oder bereits gekillten Tab", async () => {
    const backend = createDemoPtyBackend();
    const onOutput = vi.fn();
    await backend.spawn({
      tabId: "tab-1",
      cwd: "/demo/project",
      cols: 80,
      rows: 24,
      onOutput,
    });
    backend.kill("tab-1");

    expect(() => {
      backend.emit("tab-1", "zu spät");
    }).not.toThrow();
    expect(onOutput).not.toHaveBeenCalled();
  });
});
