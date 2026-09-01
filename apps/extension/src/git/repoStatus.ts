// Local (no-forge) git branch/ahead-behind/dirty status — the "local git
// status half" that .scratch/git-forge-integration/issues/02 says already
// exists via gitStatus.ts/gitDecorationProvider.ts. Those only cover
// per-file status though; this covers the per-repo summary (branch name,
// ahead/behind its upstream, dirty file count) that the explorer root items
// and the cross-repo overview view both need. Split from forgeStatus.ts (the
// GitHub half) so this half never depends on the `gh` CLI being installed.
import { execFile } from "node:child_process";

export interface LocalRepoStatus {
  branch: string;
  /** `undefined` when the branch has no upstream (ahead/behind is
   * meaningless without one) rather than when it's merely 0/0. */
  aheadBehind: { ahead: number; behind: number } | undefined;
  dirtyCount: number;
}

/** Parses the header line of `git status --porcelain=v1 --branch` output —
 * one of:
 * - `## main...origin/main [ahead 2, behind 1]`
 * - `## main...origin/main` (in sync with upstream)
 * - `## main` (no upstream configured)
 * - `## HEAD (no branch)` (detached HEAD)
 */
export function parseBranchHeader(line: string): { branch: string; aheadBehind: LocalRepoStatus["aheadBehind"] } {
  const body = line.replace(/^## /, "");
  if (/^HEAD \(no branch\)$/.exec(body)) return { branch: "HEAD (detached)", aheadBehind: undefined };

  const withUpstream = /^([^.]+)\.\.\.\S+(?: \[([^\]]+)\])?$/.exec(body);
  if (withUpstream) {
    const [, branch, bracket] = withUpstream;
    if (!bracket) return { branch, aheadBehind: { ahead: 0, behind: 0 } };
    const ahead = Number(/ahead (\d+)/.exec(bracket)?.[1] ?? 0);
    const behind = Number(/behind (\d+)/.exec(bracket)?.[1] ?? 0);
    return { branch, aheadBehind: { ahead, behind } };
  }

  return { branch: body, aheadBehind: undefined };
}

/** Counts the non-header lines — each is one changed/untracked file, same
 * lines `parsePorcelain` (gitStatus.ts) would map, just counted rather than
 * resolved to per-path badges. */
export function countDirtyLines(output: string): number {
  let count = 0;
  let pos = output.indexOf("\n");
  if (pos === -1) return 0; // No header/no body

  pos++; // Skip the header newline
  while (pos < output.length) {
    const nextNewline = output.indexOf("\n", pos);
    if (nextNewline === -1) {
      if (pos < output.length) count++; // Non-empty final line
      break;
    }
    if (nextNewline > pos) {
      count++; // Non-empty line between pos and nextNewline
    }
    pos = nextNewline + 1;
  }
  return count;
}

/** Whether a filesystem-watcher path is `git status` rewriting `.git/index`
 * (its cached stat info) rather than a real change worth reacting to — see
 * `extension.ts`'s `scheduleExternalRefresh` for why this guard exists at
 * all. Deliberately does NOT match `.git/HEAD` or `.git/refs/**` — a real
 * commit, checkout, or branch switch still needs to trigger a refresh. */
export function isGitIndexNoise(path: string): boolean {
  return /\/\.git\/index(\.lock)?$/.test(path);
}

/** Shells out to `git status --porcelain=v1 --branch` in `cwd` and combines
 * the header + dirty-line count into one summary. Resolves to `undefined`
 * for anything not a usable git repo (not installed, not a repo, no
 * commits yet) rather than rejecting — same "stay silent" contract as
 * `runGitStatus` in gitStatus.ts. */
export function getLocalRepoStatus(cwd: string): Promise<LocalRepoStatus | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain=v1", "--branch", "--ignored=matching"],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const firstNewline = stdout.indexOf("\n");
        const header = firstNewline !== -1 ? stdout.slice(0, firstNewline) : stdout;
        if (!header.startsWith("## ")) {
          resolve(undefined);
          return;
        }
        const { branch, aheadBehind } = parseBranchHeader(header);
        resolve({ branch, aheadBehind, dirtyCount: countDirtyLines(stdout) });
      },
    );
  });
}
