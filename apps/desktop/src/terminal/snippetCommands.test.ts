import { beforeEach, describe, expect, it, vi } from "vitest";
import { snippetInit, snippetList } from "./snippetCommands";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => {
  invoke.mockReset();
});

describe("snippetInit", () => {
  it("ruft snippet_init mit dem Projektpfad auf", async () => {
    invoke.mockResolvedValue(undefined);

    await snippetInit("/p");

    expect(invoke).toHaveBeenCalledWith("snippet_init", { projectPath: "/p" });
  });
});

describe("snippetList", () => {
  it("ruft snippet_list auf und ergänzt kind: \"snippet\"", async () => {
    invoke.mockResolvedValue([
      { trigger: "hello", description: "Say hello", body: "Hello, world!" },
    ]);

    const snippets = await snippetList("/p");

    expect(invoke).toHaveBeenCalledWith("snippet_list", { projectPath: "/p" });
    expect(snippets).toEqual([
      { trigger: "hello", description: "Say hello", body: "Hello, world!", kind: "snippet" },
    ]);
  });

  it("gibt eine leere Liste zurück, wenn keine Snippets existieren", async () => {
    invoke.mockResolvedValue([]);

    const snippets = await snippetList("/p");

    expect(snippets).toEqual([]);
  });
});
