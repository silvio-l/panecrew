import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GitRepoSummary } from "../types/gitStatus";
import { GitRepoReadout } from "./GitRepoReadout";

const summary = (overrides: Partial<GitRepoSummary> = {}): GitRepoSummary => ({
  branch: { name: "dev", detached: false, ahead: null, behind: null },
  dirtyCount: 0,
  worktree: null,
  ...overrides,
});

describe("GitRepoReadout", () => {
  it("shows the branch name and nothing else on a clean repo with no upstream", () => {
    render(<GitRepoReadout summary={summary()} />);

    expect(screen.getByText("dev")).toBeInTheDocument();
    expect(screen.queryByText("●")).not.toBeInTheDocument();
    expect(screen.queryByText("↑")).not.toBeInTheDocument();
    expect(screen.queryByText("↓")).not.toBeInTheDocument();
  });

  it("shows the dirty count when there are staged/unstaged/conflicted files", () => {
    render(<GitRepoReadout summary={summary({ dirtyCount: 3 })} />);

    expect(screen.getByText("●")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(
      screen.getByText("3 geänderte Dateien"),
    ).toBeInTheDocument();
  });

  it("hides the dirty readout on a clean repo", () => {
    render(<GitRepoReadout summary={summary({ dirtyCount: 0 })} />);

    expect(screen.queryByText("●")).not.toBeInTheDocument();
  });

  it("shows ahead and behind arrows independently", () => {
    render(
      <GitRepoReadout
        summary={summary({
          branch: { name: "dev", detached: false, ahead: 2, behind: 5 },
        })}
      />,
    );

    expect(screen.getByText("↑")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("↓")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("hides ahead/behind arrows when there is no upstream", () => {
    render(
      <GitRepoReadout
        summary={summary({
          branch: { name: "dev", detached: false, ahead: null, behind: null },
        })}
      />,
    );

    expect(screen.queryByText("↑")).not.toBeInTheDocument();
    expect(screen.queryByText("↓")).not.toBeInTheDocument();
  });

  it("hides ahead/behind arrows when the branch is fully in sync", () => {
    render(
      <GitRepoReadout
        summary={summary({
          branch: { name: "dev", detached: false, ahead: 0, behind: 0 },
        })}
      />,
    );

    expect(screen.queryByText("↑")).not.toBeInTheDocument();
    expect(screen.queryByText("↓")).not.toBeInTheDocument();
  });

  it("labels a detached HEAD instead of showing an empty branch name", () => {
    render(
      <GitRepoReadout
        summary={summary({
          branch: { name: null, detached: true, ahead: null, behind: null },
        })}
      />,
    );

    expect(screen.getByText("detached HEAD")).toBeInTheDocument();
  });

  it("names the main repo and the checked-out branch for a worktree", () => {
    render(
      <GitRepoReadout
        summary={summary({ worktree: { mainRepoName: "panecrew" } })}
      />,
    );

    expect(
      screen.getByText("Worktree von panecrew, Branch dev"),
    ).toBeInTheDocument();
  });
});
