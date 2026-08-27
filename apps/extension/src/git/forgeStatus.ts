// GitHub PR/CI status via the `gh` CLI — .scratch/git-forge-integration
// issue 01. Deliberately shells out to `gh` rather than calling the GitHub
// API directly: reuses whatever auth the user already has (`gh auth
// token`), no OAuth device flow or vscode.SecretStorage-backed token needed
// for v1. Not installed / not authed / no PR for the current branch all
// resolve to `undefined` — read-only, best-effort, never an error state
// that blocks the rest of the explorer.
import { execFile } from "node:child_process";

export type CiStatus = "passing" | "failing" | "running" | "unknown";

export interface PullRequestStatus {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  ci: CiStatus;
}

interface StatusCheckRollupItem {
  // Legacy "status context" shape.
  state?: string;
  // Modern "check run" shape.
  status?: string;
  conclusion?: string | null;
}

const FAILING_STATES = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"]);
const RUNNING_STATES = new Set(["PENDING", "IN_PROGRESS", "QUEUED", "REQUESTED", "WAITING"]);

/** Aggregates every check/status-context on the PR into one overall CI
 * status: any failure wins over any still-running check, which wins over
 * "all passing" — a rollup is only fully "passing" once nothing is still
 * failing or pending. */
export function aggregateCiStatus(checks: StatusCheckRollupItem[]): CiStatus {
  if (checks.length === 0) return "unknown";
  const states = checks.map((check) => (check.state ?? check.conclusion ?? check.status ?? "").toUpperCase());
  if (states.some((state) => FAILING_STATES.has(state))) return "failing";
  if (states.some((state) => RUNNING_STATES.has(state) || state === "")) return "running";
  return "passing";
}

interface GhPrViewJson {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  statusCheckRollup?: StatusCheckRollupItem[];
}

function execGh(args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("gh", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? undefined : stdout);
    });
  });
}

/** Whether `gh` is installed and logged in — checked once per session
 * (cached by the caller) since it never changes mid-session and every PR
 * lookup would otherwise pay for a redundant `gh auth status` round-trip. */
export async function isGhAvailable(): Promise<boolean> {
  const output = await execGh(["auth", "token"], process.cwd());
  return typeof output === "string" && output.trim().length > 0;
}

/** Looks up the open PR (if any) for the branch currently checked out in
 * `cwd`, plus its aggregated CI status. No remote, no `gh`, not logged in,
 * or no PR for this branch all resolve to `undefined`. */
export async function getPullRequestStatus(cwd: string): Promise<PullRequestStatus | undefined> {
  const output = await execGh(
    ["pr", "view", "--json", "number,url,state,isDraft,statusCheckRollup"],
    cwd,
  );
  if (!output) return undefined;
  let parsed: GhPrViewJson;
  try {
    parsed = JSON.parse(output) as GhPrViewJson;
  } catch {
    return undefined;
  }
  if (typeof parsed.number !== "number") return undefined;
  return {
    number: parsed.number,
    url: parsed.url,
    state: parsed.state as PullRequestStatus["state"],
    isDraft: parsed.isDraft,
    ci: aggregateCiStatus(parsed.statusCheckRollup ?? []),
  };
}
