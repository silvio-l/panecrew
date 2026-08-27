// Combines the local (repoStatus.ts) and GitHub-forge (forgeStatus.ts)
// halves into one per-project summary, plus the formatting shared by the
// explorer root items and the cross-repo overview view.
import { getLocalRepoStatus } from "./repoStatus";
import { getPullRequestStatus, type CiStatus, type PullRequestStatus } from "./forgeStatus";

export interface ProjectStatus {
  branch: string;
  aheadBehind: { ahead: number; behind: number } | undefined;
  dirtyCount: number;
  pr: PullRequestStatus | undefined;
}

/** `undefined` when `cwd` isn't a usable git repo at all — same "stay
 * silent" contract as the two halves this composes. `ghAvailable` is
 * checked once per session by the caller (extension.ts) rather than per
 * project, since `gh auth token` is a fixed, session-wide fact. */
export async function getProjectStatus(cwd: string, ghAvailable: boolean): Promise<ProjectStatus | undefined> {
  const local = await getLocalRepoStatus(cwd);
  if (!local) return undefined;
  const pr = ghAvailable ? await getPullRequestStatus(cwd) : undefined;
  return { branch: local.branch, aheadBehind: local.aheadBehind, dirtyCount: local.dirtyCount, pr };
}

const CI_ICON: Record<CiStatus, string> = {
  passing: "$(check)",
  failing: "$(error)",
  running: "$(sync)",
  unknown: "",
};

/** One-line summary for a `TreeItem.description` — e.g.
 * `main ↑2 · 3 changed · PR #12 $(check)`. Omits every part that has
 * nothing to say (an in-sync branch's ahead/behind, a clean repo's dirty
 * count, no open PR) rather than padding with zeros. */
export function formatStatusLabel(status: ProjectStatus): string {
  const parts = [status.branch];

  if (status.aheadBehind) {
    const { ahead, behind } = status.aheadBehind;
    const arrows = [ahead > 0 ? `↑${ahead}` : "", behind > 0 ? `↓${behind}` : ""].filter(Boolean).join("");
    if (arrows) parts.push(arrows);
  }

  if (status.dirtyCount > 0) parts.push(`${status.dirtyCount} changed`);

  if (status.pr) {
    const draft = status.pr.isDraft ? " (draft)" : "";
    parts.push(`PR #${status.pr.number}${draft} ${CI_ICON[status.pr.ci]}`.trim());
  }

  return parts.join(" · ");
}
