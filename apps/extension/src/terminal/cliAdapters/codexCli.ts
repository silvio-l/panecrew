// Pure `~/.codex/config.toml` (user-level — Codex CLI has no project-level
// config) `notify` patcher — .scratch/pane-attention-notifications ticket
// 05. Codex only supports a single `notify` program (not an array of hook
// entries like Claude Code/Gemini CLI's JSON hooks), so this can't reuse
// jsonHookPatch.ts's merge-into-array approach — it locates and replaces the
// single top-level `notify = [...]` line/block instead. No full TOML
// parser: a small hand-rolled line/bracket scanner is enough for the one
// key this needs to find, same "no bespoke general-purpose parser for a
// narrow need" call as treeDataProvider.ts's exclude-glob matcher.
import { NOTIFY_REDIRECT_TARGET } from "./notifyTarget";

export interface PatchResult {
  text: string;
  changed: boolean;
}

/** Runs `sh -c '<script>'` with Codex's own JSON-argument appended
 * (ignored — `$1`, unused) and writes the OSC 9 notify sequence straight to
 * the terminal's own tty. The printf argument uses double quotes (not
 * single) specifically so this whole line can be written as a single-line
 * TOML *literal* string (`'...'`), which passes `\033`/`\007` through to
 * `printf` untouched instead of TOML trying to interpret them as its own
 * (invalid) escape sequences. `2>/dev/null || true` keeps this a no-op (not
 * a notify error) when there's no controlling terminal to write to, e.g. a
 * headless/background session with no /dev/tty (see `notifyTarget.ts` for
 * the Windows case). */
export const CODEX_NOTIFY_LINE =
  `notify = ["sh", "-c", 'printf "\\033]9;Codex needs your attention\\007" > ${NOTIFY_REDIRECT_TARGET} 2>/dev/null || true']`;

const NOTIFY_KEY_PATTERN = /^notify\s*=/;

function bracketBalance(line: string): number {
  let balance = 0;
  for (const char of line) {
    if (char === "[") balance++;
    else if (char === "]") balance--;
  }
  return balance;
}

/** Finds the full line range (start index, end index exclusive) of an
 * existing top-level `notify = ...` entry, scanning forward past any
 * multi-line array value until brackets balance. Throws if the value's
 * brackets never balance before EOF — a malformed/truncated config this
 * scanner can't safely patch around. Returns `null` if no `notify` key is
 * present at all. */
function findNotifyLineRange(lines: string[], malformedMessage: string): { start: number; end: number } | null {
  const start = lines.findIndex((line) => NOTIFY_KEY_PATTERN.test(line));
  if (start === -1) return null;

  let balance = bracketBalance(lines[start]);
  let end = start + 1;
  while (balance > 0) {
    if (end >= lines.length) throw new Error(malformedMessage);
    balance += bracketBalance(lines[end]);
    end++;
  }
  return { start, end };
}

export function computePatchedConfig(existingConfigText: string | undefined): PatchResult {
  const malformedMessage =
    "PaneCrew: ~/.codex/config.toml has a notify entry PaneCrew can't safely parse — fix it manually before configuring notifications.";
  const original = existingConfigText ?? "";
  const lines = original.length > 0 ? original.split("\n") : [];

  const range = findNotifyLineRange(lines, malformedMessage);

  if (range) {
    const existingValue = lines.slice(range.start, range.end).join("\n");
    if (existingValue === CODEX_NOTIFY_LINE) {
      return { text: original, changed: false };
    }
    const patchedLines = [...lines.slice(0, range.start), CODEX_NOTIFY_LINE, ...lines.slice(range.end)];
    return { text: patchedLines.join("\n"), changed: true };
  }

  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    return { text: `${CODEX_NOTIFY_LINE}\n`, changed: true };
  }
  const trailingNewline = original.endsWith("\n");
  const body = trailingNewline ? original.slice(0, -1) : original;
  return { text: `${body}\n${CODEX_NOTIFY_LINE}\n`, changed: true };
}
