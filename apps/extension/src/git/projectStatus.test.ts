import { describe, expect, it } from "vitest";
import { formatStatusLabel, type ProjectStatus } from "./projectStatus";

function status(overrides: Partial<ProjectStatus> = {}): ProjectStatus {
  return { branch: "main", aheadBehind: undefined, dirtyCount: 0, pr: undefined, ...overrides };
}

describe("formatStatusLabel", () => {
  it("shows just the branch when everything else is clean/absent", () => {
    expect(formatStatusLabel(status())).toBe("main");
  });

  it("shows ahead and behind arrows", () => {
    expect(formatStatusLabel(status({ aheadBehind: { ahead: 2, behind: 1 } }))).toBe("main · ↑2↓1");
  });

  it("omits a zero ahead/behind side", () => {
    expect(formatStatusLabel(status({ aheadBehind: { ahead: 3, behind: 0 } }))).toBe("main · ↑3");
  });

  it("omits ahead/behind entirely when in sync", () => {
    expect(formatStatusLabel(status({ aheadBehind: { ahead: 0, behind: 0 } }))).toBe("main");
  });

  it("shows the dirty count", () => {
    expect(formatStatusLabel(status({ dirtyCount: 4 }))).toBe("main · 4 changed");
  });

  it("shows an open PR with its CI status", () => {
    expect(
      formatStatusLabel(
        status({ pr: { number: 12, url: "https://x", state: "OPEN", isDraft: false, ci: "passing" } }),
      ),
    ).toBe("main · PR #12 $(check)");
  });

  it("marks a draft PR", () => {
    expect(
      formatStatusLabel(
        status({ pr: { number: 12, url: "https://x", state: "OPEN", isDraft: true, ci: "unknown" } }),
      ),
    ).toBe("main · PR #12 (draft)");
  });

  it("combines every part", () => {
    expect(
      formatStatusLabel(
        status({
          aheadBehind: { ahead: 1, behind: 0 },
          dirtyCount: 2,
          pr: { number: 5, url: "https://x", state: "OPEN", isDraft: false, ci: "failing" },
        }),
      ),
    ).toBe("main · ↑1 · 2 changed · PR #5 $(error)");
  });
});
