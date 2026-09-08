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
// ⚡ Bolt optimization: Avoid String.prototype.split("\n") on large CLI outputs
// to prevent massive array allocations and GC pauses on large repos.
// Also added an early break in the ancestor directory traversal loop.
export function parsePorcelain(output: string, repoRoot: string): Map<string, GitFileStatus> {
  const result = new Map<string, GitFileStatus>();
  let pos = 0;
  const root = repoRoot.replace(/\/$/, "");

  while (pos < output.length) {
    const nextNewline = output.indexOf("\n", pos);
    const end = nextNewline === -1 ? output.length : nextNewline;
    const lineLen = end - pos;

    if (lineLen >= 4) {
      const x = output[pos];
      const y = output[pos + 1];

      const restStart = pos + 3;
      let path = output.slice(restStart, end);

      const arrowIdx = path.indexOf(" -> ");
      if (arrowIdx !== -1) {
        path = path.slice(arrowIdx + 4);
      }

      const code = x !== " " && x !== "?" ? x : y;
      const status = STATUS_BY_CODE[code];
      if (status) {
        const absolute = `${root}/${path.startsWith("./") ? path.slice(2) : path}`;
        result.set(absolute, status);

        // Propagate the status up to every ancestor directory too, so a folder
        // containing a modified file also shows a (subdued) decoration — same
        // convention VS Code's built-in git decorations use for directories.
        let dir = absolute;
        for (;;) {
          const parent = dir.slice(0, dir.lastIndexOf("/"));
          if (!parent || parent === root || parent.length >= dir.length) break;
          // Early break: if this parent already has a status, its ancestors do too.
          if (result.has(parent)) break;
          result.set(parent, status);
          dir = parent;
        }
      }
    }

    if (nextNewline === -1) break;
    pos = nextNewline + 1;
  }

  return result;
}
