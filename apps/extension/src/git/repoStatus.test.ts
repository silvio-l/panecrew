import { describe, expect, it } from "vitest";
import { countDirtyLines, parseBranchHeader } from "./repoStatus";

describe("parseBranchHeader", () => {
  it("parses a branch ahead and behind its upstream", () => {
    expect(parseBranchHeader("## main...origin/main [ahead 2, behind 1]")).toEqual({
      branch: "main",
      aheadBehind: { ahead: 2, behind: 1 },
    });
  });

  it("parses a branch only ahead", () => {
    expect(parseBranchHeader("## feat/x...origin/feat/x [ahead 3]")).toEqual({
      branch: "feat/x",
      aheadBehind: { ahead: 3, behind: 0 },
    });
  });

  it("parses a branch in sync with its upstream", () => {
    expect(parseBranchHeader("## main...origin/main")).toEqual({
      branch: "main",
      aheadBehind: { ahead: 0, behind: 0 },
    });
  });

  it("parses a branch with no upstream configured", () => {
    expect(parseBranchHeader("## scratch-branch")).toEqual({
      branch: "scratch-branch",
      aheadBehind: undefined,
    });
  });

  it("parses detached HEAD", () => {
    expect(parseBranchHeader("## HEAD (no branch)")).toEqual({
      branch: "HEAD (detached)",
      aheadBehind: undefined,
    });
  });
});

describe("countDirtyLines", () => {
  it("counts lines after the branch header", () => {
    const output = "## main...origin/main\n M src/index.ts\n?? notes.md\n";
    expect(countDirtyLines(output)).toBe(2);
  });

  it("returns 0 for a clean repo", () => {
    expect(countDirtyLines("## main...origin/main\n")).toBe(0);
  });
});
