// Pure git-status parsing, split out from gitDecorationProvider.ts so this
// half has no `vscode` import and is directly reachable from vitest (the
// `vscode` module only exists inside a real extension host, so any file that
// imports it can't be loaded by a plain Node test runner). `runGitStatus`
// shells out via `node:child_process`, a real Node built-in, which is fine
// under both vitest and the extension host.
import { execFile } from "node:child_process";

export type GitFileStatus = "modified" | "added" | "untracked" | "deleted" | "ignored";

const STATUS_BY_CODE: Partial<Record<string, GitFileStatus>> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "modified",
  C: "added",
  U: "modified",
  "?": "untracked",
  "!": "ignored",
};

export const BADGE_BY_STATUS: Record<GitFileStatus, string> = {
  modified: "M",
  added: "A",
  untracked: "U",
  deleted: "D",
  ignored: "!",
};

export const COLOR_ID_BY_STATUS: Record<GitFileStatus, string> = {
  modified: "gitDecoration.modifiedResourceForeground",
  added: "gitDecoration.untrackedResourceForeground",
  untracked: "gitDecoration.untrackedResourceForeground",
  deleted: "gitDecoration.deletedResourceForeground",
  ignored: "gitDecoration.ignoredResourceForeground",
};

/** Shells out to `git status --porcelain=v1` in `cwd`. Not a git repo, git
 * not installed, or any other failure resolves to `""` (no decorations for
 * this folder) rather than rejecting — PaneCrew must host arbitrary,
 * not-necessarily-git projects without surfacing an error for that. */
export function runGitStatus(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain=v1", "--ignored=matching"],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        resolve(error ? "" : stdout);
      },
    );
  });
}

/** Parses `git status --porcelain=v1` output into a map of absolute path ->
 * status. Porcelain v1 lines are `XY PATH` (or `XY PATH -> NEWPATH` for
 * renames); only the first non-space status column is used since the
 * decoration is a single badge, not a two-column stage/worktree pair. */
export function parsePorcelain(output: string, repoRoot: string): Map<string, GitFileStatus> {
  const result = new Map<string, GitFileStatus>();
  let pos = 0;

  while (pos < output.length) {
    const nextNewline = output.indexOf("\n", pos);
    const lineEnd = nextNewline === -1 ? output.length : nextNewline;
    const line = output.slice(pos, lineEnd);
    pos = lineEnd + 1;

    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const rest = line.slice(3);
    const path = rest.includes(" -> ") ? (rest.split(" -> ")[1]) : rest;
    const code = x !== " " && x !== "?" ? x : y;
    const status = STATUS_BY_CODE[code];
    if (!status) continue;
    const absolute = joinPosix(repoRoot, path);
    result.set(absolute, status);
    // Propagate the status up to every ancestor directory too, so a folder
    // containing a modified file also shows a (subdued) decoration — same
    // convention VS Code's built-in git decorations use for directories.
    let dir = absolute;
    for (;;) {
      const parent = dir.slice(0, dir.lastIndexOf("/"));
      if (!parent || parent === repoRoot || parent.length >= dir.length) break;
      if (!result.has(parent)) result.set(parent, status);
      dir = parent;
    }
  }
  return result;
}

function joinPosix(root: string, relative: string): string {
  return `${root.replace(/\/$/, "")}/${relative.replace(/^\.\//, "")}`;
}
