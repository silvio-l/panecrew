import type { BufferPosition } from "./suggestion";

// Decides whether the `://` snippet/System-Befehl popup should be showing —
// and, given a candidate list, which entries currently match. Pure and
// decoupled from xterm.js/Tauri IPC, same split as `suggestion.ts`'s
// `cdCompletion`/`cdArgument`: reading real screen content (never a mirrored
// keystroke log — see that file's header comment for why) is the caller's
// job, this only decides what it means.

export interface SnippetTriggerInput {
  bufferType: "normal" | "alternate";
  anchor: BufferPosition | null;
  cursor: BufferPosition;
  rowText: string;
}

export interface SnippetTriggerState {
  /** Column where the `://` trigger starts — the replacement span's left edge. */
  start: number;
  /** Text typed after `://`, used to filter candidates. */
  filter: string;
}

/**
 * Where the `://` trigger is active — or null.
 *
 * The trigger word is the CURRENT trailing word of the typed input (the run
 * of non-space characters ending at the cursor): it must start with `://`.
 * That single rule covers both required cases at once — input-start and
 * right-after-a-space both produce a fresh word — and rejects the one
 * required negative case for free: `https://example.com`'s word is
 * "https://example.com", which does not itself START with `://`, so it never
 * matches even though it contains the same three characters mid-word.
 */
export function snippetTrigger({
  bufferType,
  anchor,
  cursor,
  rowText,
}: SnippetTriggerInput): SnippetTriggerState | null {
  if (bufferType !== "normal" || !anchor) return null;
  if (anchor.y !== cursor.y || cursor.x < anchor.x) return null;
  // Cursor must sit at the end of the current word — the same "editing the
  // middle of the line" guard `cdCompletion` uses, for the same reason: text
  // right after the cursor means the trigger word isn't the one being typed.
  if (cursor.x < rowText.length && rowText[cursor.x] !== " ") return null;

  const input = rowText.slice(anchor.x, cursor.x);
  const wordStart = input.lastIndexOf(" ") + 1;
  const word = input.slice(wordStart);
  if (!word.startsWith("://")) return null;

  return { start: anchor.x + wordStart, filter: word.slice(3) };
}

export interface SnippetCandidate {
  /** Matched against the filter text, case-insensitively. */
  trigger: string;
  description: string;
  kind: "command" | "snippet";
  /** Static insertion text for a `"snippet"` candidate — absent for a
   * `"command"`, which performs an action instead of inserting text. */
  body?: string;
}

/** Narrows `candidates` by trigger name OR description (user story: "filter by name or description"). */
export function filterSnippetCandidates(
  candidates: readonly SnippetCandidate[],
  filter: string,
): SnippetCandidate[] {
  if (!filter) return [...candidates];
  const needle = filter.toLowerCase();
  return candidates.filter(
    (candidate) =>
      candidate.trigger.toLowerCase().includes(needle) ||
      candidate.description.toLowerCase().includes(needle),
  );
}

/**
 * Backspaces to erase the currently typed `://…` span before writing a
 * snippet's body or running a command.
 *
 * No cursor position needed: by `snippetTrigger`'s own construction, the span
 * from `start` to the cursor is always exactly `://` plus `filter` — deriving
 * the length from `span` itself (like `completionInsert` derives its own
 * delta from `prefix`, not a live cursor read) means an accept computed one
 * render pass after the matching `update()` still erases the right amount,
 * even if it ran from a snapshot rather than the current screen.
 */
export function snippetErase(span: SnippetTriggerState): string {
  return "\x7f".repeat(3 + span.filter.length);
}
