import { describe, expect, it } from "vitest";
import { gitDecorationsFromStatuses } from "./gitStatus";

describe("gitDecorationsFromStatuses", () => {
  it("decorates a modified file and every one of its ancestor folders", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/components/ExplorerPanel.tsx", status: "modified" },
    ]);

    expect(decorations.get("src/components/ExplorerPanel.tsx")).toBe(
      "modified",
    );
    expect(decorations.get("src/components")).toBe("modified");
    expect(decorations.get("src")).toBe("modified");
  });

  it("decorates an untracked file and its ancestors the same way", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/types/project.test.ts", status: "untracked" },
    ]);

    expect(decorations.get("src/types/project.test.ts")).toBe("untracked");
    expect(decorations.get("src/types")).toBe("untracked");
    expect(decorations.get("src")).toBe("untracked");
  });

  it("decorates a root-level file only, with no ancestor to climb to", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "README.md", status: "modified" },
    ]);

    expect(decorations.size).toBe(1);
    expect(decorations.get("README.md")).toBe("modified");
  });

  it("leaves unrelated paths undecorated", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/App.tsx", status: "modified" },
    ]);

    expect(decorations.has("src/components")).toBe(false);
    expect(decorations.has("README.md")).toBe(false);
  });

  it("a modified descendant outranks an untracked sibling on their shared ancestor", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/types/gitStatus.ts", status: "untracked" },
      { path: "src/App.tsx", status: "modified" },
    ]);

    expect(decorations.get("src")).toBe("modified");
    // Each file itself keeps its own real status — only the shared ancestor
    // is forced to the more significant one.
    expect(decorations.get("src/types/gitStatus.ts")).toBe("untracked");
  });

  it("an untracked find never downgrades a folder already marked modified", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/App.tsx", status: "modified" },
      { path: "src/types/gitStatus.ts", status: "untracked" },
    ]);

    expect(decorations.get("src")).toBe("modified");
  });
});
