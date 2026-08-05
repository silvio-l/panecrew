import { describe, expect, it } from "vitest";
import { filterTree } from "./treeFilter";
import type { TreeNode } from "./project";

const TREE: TreeNode[] = [
  {
    name: "src",
    children: [
      { name: "App.tsx", kind: "tsx" },
      { name: "App.test.tsx", kind: "tsx" },
      {
        name: "components",
        children: [
          { name: "ExplorerPanel.tsx", kind: "tsx" },
          { name: "TitleBar.tsx", kind: "tsx" },
        ],
      },
    ],
  },
  { name: "README.md", kind: "md" },
];

describe("filterTree", () => {
  it("returns null for an empty or whitespace-only query, leaving the tree untouched", () => {
    expect(filterTree(TREE, "")).toBeNull();
    expect(filterTree(TREE, "   ")).toBeNull();
  });

  it("keeps only the path to matching files, dropping non-matching siblings", () => {
    const filtered = filterTree(TREE, "titlebar");

    expect(filtered).toEqual([
      {
        name: "src",
        children: [
          {
            name: "components",
            children: [{ name: "TitleBar.tsx", kind: "tsx" }],
          },
        ],
      },
    ]);
  });

  it("matches case-insensitively", () => {
    const filtered = filterTree(TREE, "TITLEBAR");

    expect(filtered?.[0]?.children?.[0]?.children).toEqual([
      { name: "TitleBar.tsx", kind: "tsx" },
    ]);
  });

  it("matches by substring, not full name", () => {
    const filtered = filterTree(TREE, "app");

    expect(filtered?.[0]?.children).toEqual([
      { name: "App.tsx", kind: "tsx" },
      { name: "App.test.tsx", kind: "tsx" },
    ]);
  });

  it("keeps a root-level file match without any folder wrapper", () => {
    const filtered = filterTree(TREE, "readme");

    expect(filtered).toEqual([{ name: "README.md", kind: "md" }]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterTree(TREE, "nonexistent-xyz")).toEqual([]);
  });

  it("drops a folder entirely when neither its name nor any descendant matches", () => {
    const filtered = filterTree(TREE, "titlebar");

    const srcChildren = filtered?.[0]?.children ?? [];
    expect(srcChildren.some((node) => node.name === "App.tsx")).toBe(false);
  });
});
