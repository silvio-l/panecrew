import { describe, expect, it } from "vitest";
import { fileKindFromName, treeNodesFromRaw } from "./project";

describe("fileKindFromName", () => {
  it.each([
    ["index.ts", "ts"],
    ["App.tsx", "tsx"],
    ["script.js", "js"],
    ["package.json", "json"],
    ["main.rs", "rs"],
    ["Cargo.toml", "toml"],
    ["README.md", "md"],
    ["App.css", "css"],
    ["index.html", "html"],
    ["build.sh", "sh"],
    ["Cargo.lock", "lock"],
  ] as const)("maps %s to kind %s", (name, kind) => {
    expect(fileKindFromName(name)).toBe(kind);
  });

  it("is case-insensitive on the extension", () => {
    expect(fileKindFromName("Main.RS")).toBe("rs");
  });

  it("falls back to 'file' for an unknown or missing extension", () => {
    expect(fileKindFromName("LICENSE")).toBe("file");
    expect(fileKindFromName("Dockerfile")).toBe("file");
  });

  it("treats known git dotfiles as kind 'git' even though .git itself is never listed", () => {
    expect(fileKindFromName(".gitignore")).toBe("git");
    expect(fileKindFromName(".gitattributes")).toBe("git");
  });

  it("does not treat a leading dot alone as an extension", () => {
    expect(fileKindFromName(".env")).toBe("file");
  });
});

describe("treeNodesFromRaw", () => {
  it("maps a file node to a kind, no children field", () => {
    const [node] = treeNodesFromRaw([{ name: "index.ts" }]);

    expect(node).toEqual({ name: "index.ts", kind: "ts" });
  });

  it("maps a directory node to children, no kind field, recursively", () => {
    const [node] = treeNodesFromRaw([
      { name: "src", children: [{ name: "main.rs" }] },
    ]);

    expect(node).toEqual({
      name: "src",
      children: [{ name: "main.rs", kind: "rs" }],
    });
  });

  it("preserves the order the backend already sorted", () => {
    const nodes = treeNodesFromRaw([
      { name: "src", children: [] },
      { name: "Cargo.toml" },
    ]);

    expect(nodes.map((node) => node.name)).toEqual(["src", "Cargo.toml"]);
  });
});
