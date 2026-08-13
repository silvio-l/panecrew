import { describe, expect, it } from "vitest";
import {
  collectLoadedFolderPaths,
  fileKindFromName,
  treeNodesFromRawEntries,
  withChildrenAt,
} from "./project";
import type { TreeNode } from "./project";

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

describe("treeNodesFromRawEntries", () => {
  it("maps a file entry to a kind, isDirectory false, no children field", () => {
    const [node] = treeNodesFromRawEntries([{ name: "index.ts", is_dir: false }]);

    expect(node).toEqual({ name: "index.ts", isDirectory: false, kind: "ts" });
  });

  it("maps a directory entry to isDirectory true, no kind, and no children — unbeladen bis explorer_read_dir erneut aufgerufen wird", () => {
    const [node] = treeNodesFromRawEntries([{ name: "src", is_dir: true }]);

    expect(node).toEqual({ name: "src", isDirectory: true });
  });

  it("preserves the order the backend already sorted", () => {
    const nodes = treeNodesFromRawEntries([
      { name: "src", is_dir: true },
      { name: "Cargo.toml", is_dir: false },
    ]);

    expect(nodes.map((node) => node.name)).toEqual(["src", "Cargo.toml"]);
  });
});

describe("withChildrenAt", () => {
  const FILE: TreeNode = { name: "main.rs", isDirectory: false, kind: "rs" };

  it("sets children on a top-level, still-unloaded directory", () => {
    const tree: TreeNode[] = [{ name: "src", isDirectory: true }];

    const result = withChildrenAt(tree, "src", [FILE]);

    expect(result).toEqual([{ name: "src", isDirectory: true, children: [FILE] }]);
  });

  it("sets children on a nested directory, leaving loaded siblings untouched", () => {
    const tree: TreeNode[] = [
      {
        name: "src",
        isDirectory: true,
        children: [
          { name: "explorer", isDirectory: true },
          FILE,
        ],
      },
    ];

    const result = withChildrenAt(tree, "src/explorer", [
      { name: "filePath.ts", isDirectory: false, kind: "ts" },
    ]);

    expect(result).toEqual([
      {
        name: "src",
        isDirectory: true,
        children: [
          {
            name: "explorer",
            isDirectory: true,
            children: [{ name: "filePath.ts", isDirectory: false, kind: "ts" }],
          },
          FILE,
        ],
      },
    ]);
  });

  it("leaves the tree unchanged when a parent on the path is not loaded yet", () => {
    const tree: TreeNode[] = [{ name: "src", isDirectory: true }];

    const result = withChildrenAt(tree, "src/explorer", [FILE]);

    expect(result).toEqual(tree);
  });

  it("does not mutate the original tree (immutable update)", () => {
    const original: TreeNode[] = [{ name: "src", isDirectory: true }];

    withChildrenAt(original, "src", [FILE]);

    expect(original).toEqual([{ name: "src", isDirectory: true }]);
  });
});

describe("collectLoadedFolderPaths", () => {
  it("returns nothing for a directory whose children are not loaded", () => {
    const tree: TreeNode[] = [{ name: "src", isDirectory: true }];

    expect(collectLoadedFolderPaths(tree, "")).toEqual([]);
  });

  it("collects a loaded directory and recurses into its loaded children only", () => {
    const tree: TreeNode[] = [
      {
        name: "src",
        isDirectory: true,
        children: [
          { name: "explorer", isDirectory: true, children: [] },
          { name: "components", isDirectory: true },
          { name: "main.ts", isDirectory: false, kind: "ts" },
        ],
      },
    ];

    expect(collectLoadedFolderPaths(tree, "")).toEqual(["src", "src/explorer"]);
  });
});
