import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchProjectTree } from "./searchTree";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => {
  invoke.mockReset();
});

describe("searchProjectTree", () => {
  it("fragt Namens- und Inhaltssuche parallel ab und vereinigt beide Bäume", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "explorer_search_names") {
        return Promise.resolve({
          nodes: [{ name: "README.md", is_dir: false }],
          truncated: false,
        });
      }
      if (cmd === "explorer_search_contents") {
        return Promise.resolve({
          nodes: [
            {
              name: "main.ts",
              is_dir: false,
              matches: [{ line: 3, preview: "const README = 1" }],
            },
          ],
          truncated: false,
        });
      }
      throw new Error(`unerwarteter Befehl: ${cmd}`);
    });

    const result = await searchProjectTree("/repo", "readme");

    expect(result.truncated).toBe(false);
    expect(result.nodes).toEqual([
      { name: "main.ts", isDirectory: false, kind: "ts", matches: [{ line: 3, preview: "const README = 1" }] },
      { name: "README.md", isDirectory: false, kind: "md" },
    ]);
  });

  it("behält die Zeilentreffer einer Datei, die sowohl über den Namen als auch über den Inhalt trifft", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "explorer_search_names") {
        return Promise.resolve({
          nodes: [{ name: "config.ts", is_dir: false }],
          truncated: false,
        });
      }
      if (cmd === "explorer_search_contents") {
        return Promise.resolve({
          nodes: [
            {
              name: "config.ts",
              is_dir: false,
              matches: [{ line: 1, preview: "export const config = {}" }],
            },
          ],
          truncated: false,
        });
      }
      throw new Error(`unerwarteter Befehl: ${cmd}`);
    });

    const result = await searchProjectTree("/repo", "config");

    expect(result.nodes).toEqual([
      {
        name: "config.ts",
        isDirectory: false,
        kind: "ts",
        matches: [{ line: 1, preview: "export const config = {}" }],
      },
    ]);
  });

  it("führt einen Ordner zusammen, der in beiden Teilsuchen unterschiedliche Kinder trifft", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "explorer_search_names") {
        return Promise.resolve({
          nodes: [
            { name: "src", is_dir: true, children: [{ name: "widget.ts", is_dir: false }] },
          ],
          truncated: false,
        });
      }
      if (cmd === "explorer_search_contents") {
        return Promise.resolve({
          nodes: [
            {
              name: "src",
              is_dir: true,
              children: [
                {
                  name: "helper.ts",
                  is_dir: false,
                  matches: [{ line: 2, preview: "widget helper" }],
                },
              ],
            },
          ],
          truncated: false,
        });
      }
      throw new Error(`unerwarteter Befehl: ${cmd}`);
    });

    const result = await searchProjectTree("/repo", "widget");

    expect(result.nodes).toEqual([
      {
        name: "src",
        isDirectory: true,
        children: [
          {
            name: "helper.ts",
            isDirectory: false,
            kind: "ts",
            matches: [{ line: 2, preview: "widget helper" }],
          },
          { name: "widget.ts", isDirectory: false, kind: "ts" },
        ],
      },
    ]);
  });

  it("meldet truncated, sobald eine der beiden Teilsuchen gekappt hat", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "explorer_search_names") {
        return Promise.resolve({ nodes: [], truncated: true });
      }
      if (cmd === "explorer_search_contents") {
        return Promise.resolve({ nodes: [], truncated: false });
      }
      throw new Error(`unerwarteter Befehl: ${cmd}`);
    });

    const result = await searchProjectTree("/repo", "abcdef");

    expect(result.truncated).toBe(true);
  });

  it("überspringt die Inhaltssuche bei einer zu kurzen Anfrage, die Namenssuche läuft trotzdem", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "explorer_search_names") {
        return Promise.resolve({ nodes: [], truncated: false });
      }
      throw new Error(`unerwarteter Befehl: ${cmd}`);
    });

    const result = await searchProjectTree("/repo", "ab");

    expect(result.nodes).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("explorer_search_names", {
      root: "/repo",
      query: "ab",
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "explorer_search_contents",
      expect.anything(),
    );
  });
});
