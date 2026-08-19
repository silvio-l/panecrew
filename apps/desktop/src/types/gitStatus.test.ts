import { describe, expect, it } from "vitest";
import { gitDecorationsFromStatuses, gitRepoSummaryFromRaw } from "./gitStatus";

describe("gitDecorationsFromStatuses", () => {
  it("decorates a modified file and every one of its ancestor folders", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/components/ExplorerPanel.tsx", states: ["unstaged"] },
    ]);

    expect(decorations.get("src/components/ExplorerPanel.tsx")).toBe(
      "modified",
    );
    expect(decorations.get("src/components")).toBe("modified");
    expect(decorations.get("src")).toBe("modified");
  });

  it("decorates an untracked file and its ancestors the same way", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/types/project.test.ts", states: ["untracked"] },
    ]);

    expect(decorations.get("src/types/project.test.ts")).toBe("untracked");
    expect(decorations.get("src/types")).toBe("untracked");
    expect(decorations.get("src")).toBe("untracked");
  });

  it("decorates a root-level file only, with no ancestor to climb to", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "README.md", states: ["staged"] },
    ]);

    expect(decorations.size).toBe(1);
    expect(decorations.get("README.md")).toBe("modified");
  });

  it("leaves unrelated paths undecorated", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/App.tsx", states: ["unstaged"] },
    ]);

    expect(decorations.has("src/components")).toBe(false);
    expect(decorations.has("README.md")).toBe(false);
  });

  it("a modified descendant outranks an untracked sibling on their shared ancestor", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/types/gitStatus.ts", states: ["untracked"] },
      { path: "src/App.tsx", states: ["unstaged"] },
    ]);

    expect(decorations.get("src")).toBe("modified");
    // Each file itself keeps its own real status — only the shared ancestor
    // is forced to the more significant one.
    expect(decorations.get("src/types/gitStatus.ts")).toBe("untracked");
  });

  it("an untracked find never downgrades a folder already marked modified", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/App.tsx", states: ["staged"] },
      { path: "src/types/gitStatus.ts", states: ["untracked"] },
    ]);

    expect(decorations.get("src")).toBe("modified");
  });

  it("treats a conflicted file as modified for tree coloring", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/App.tsx", states: ["conflicted"] },
    ]);

    expect(decorations.get("src/App.tsx")).toBe("modified");
  });

  it("a file carrying multiple states still resolves to a single decoration", () => {
    const decorations = gitDecorationsFromStatuses([
      { path: "src/App.tsx", states: ["staged", "unstaged"] },
    ]);

    expect(decorations.get("src/App.tsx")).toBe("modified");
  });
});

describe("gitRepoSummaryFromRaw", () => {
  it("returns null when the root is not a git repo", () => {
    expect(
      gitRepoSummaryFromRaw({ files: [], branch: null, worktree: null }),
    ).toBeNull();
  });

  it("carries the branch through unchanged and counts dirty files", () => {
    const summary = gitRepoSummaryFromRaw({
      files: [
        { path: "src/App.tsx", states: ["unstaged"] },
        { path: "src/new.ts", states: ["untracked"] },
        { path: "README.md", states: ["staged"] },
      ],
      branch: { name: "dev", detached: false, ahead: 2, behind: 0 },
      worktree: null,
    });

    expect(summary?.branch).toEqual({
      name: "dev",
      detached: false,
      ahead: 2,
      behind: 0,
    });
    // Untracked-only files don't count as "dirty" — only App.tsx and
    // README.md carry a staged/unstaged/conflicted state.
    expect(summary?.dirtyCount).toBe(2);
  });

  it("does not double-count a file with more than one dirty state", () => {
    const summary = gitRepoSummaryFromRaw({
      files: [{ path: "src/App.tsx", states: ["staged", "unstaged"] }],
      branch: { name: "dev", detached: false, ahead: null, behind: null },
      worktree: null,
    });

    expect(summary?.dirtyCount).toBe(1);
  });

  it("reports a clean repo with zero dirty files", () => {
    const summary = gitRepoSummaryFromRaw({
      files: [],
      branch: { name: "main", detached: false, ahead: 0, behind: 0 },
      worktree: null,
    });

    expect(summary?.dirtyCount).toBe(0);
  });

  it("maps the worktree's main repo name from snake_case", () => {
    const summary = gitRepoSummaryFromRaw({
      files: [],
      branch: { name: "feature-x", detached: false, ahead: null, behind: null },
      worktree: { main_repo_name: "panecrew" },
    });

    expect(summary?.worktree).toEqual({ mainRepoName: "panecrew" });
  });

  it("leaves worktree null for a plain (non-worktree) repo", () => {
    const summary = gitRepoSummaryFromRaw({
      files: [],
      branch: { name: "main", detached: false, ahead: null, behind: null },
      worktree: null,
    });

    expect(summary?.worktree).toBeNull();
  });

  it("carries a detached HEAD through with a null branch name", () => {
    const summary = gitRepoSummaryFromRaw({
      files: [],
      branch: { name: null, detached: true, ahead: null, behind: null },
      worktree: null,
    });

    expect(summary?.branch).toEqual({
      name: null,
      detached: true,
      ahead: null,
      behind: null,
    });
  });
});
