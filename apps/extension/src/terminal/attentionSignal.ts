// Pure OSC 9 / OSC 777 "notify" escape-sequence parser plus a per-root
// attention-state tracker, no `vscode` import — mirrors terminalLinkDetect.ts's
// isolation so it stays directly reachable from vitest.
//
// OSC 9 (iTerm2/ConEmu growl notification): ESC ] 9 ; <message> BEL|ST
// OSC 777 "notify" (rxvt-unicode convention, adopted by several CLI coding
// agents): ESC ] 777 ; notify ; <title> ; <body> BEL|ST
// Both terminators are accepted: BEL (\x07) and ST (\x1b\\). This is a
// protocol-level signal a CLI tool chooses to emit, not PaneCrew guessing at
// meaning from scrollback text — see spec.md's "no heuristic parsing"
// boundary.

export interface AttentionNotification {
  title?: string;
  body?: string;
}

const OSC = "\x1b]";
const BEL = "\x07";
const ST = "\x1b\\";

/** A real OSC 9 / OSC 777 notify payload is a short, human-readable title/body
 * string -- a few hundred bytes at most. This bounds how long an
 * unterminated `ESC ]` sequence is allowed to accumulate as `remainder`
 * before being dropped as noise rather than a genuine pending notification.
 * Without this cap, any `ESC ]` byte pair that never happens to be followed
 * by a BEL/ST terminator for the rest of a shell command's output (e.g. a
 * stray `0x1b 0x5d` inside raw/binary curl or ssh output piped to the
 * terminal) would make `remainder` grow by the size of every subsequent
 * output chunk for as long as that command keeps running -- unbounded for a
 * long-lived foreground process (a CLI agent session, `tsc --watch`, ...),
 * which is exactly the shape of a real memory-growth incident traced back
 * to this buffer (2026-08-28). */
const MAX_PENDING_LENGTH = 4096;

interface ScanResult {
  notifications: AttentionNotification[];
  /** Unconsumed tail of the scanned text — either "" (fully scanned) or a
   * trailing, not-yet-terminated `ESC ]` sequence to prepend to the next
   * chunk. */
  remainder: string;
}

function emptyToUndefined(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

function parsePayload(payload: string): AttentionNotification | null {
  if (payload.startsWith("9;")) {
    return { body: emptyToUndefined(payload.slice(2)) };
  }
  const notifyPrefix = "777;notify;";
  if (payload.startsWith(notifyPrefix)) {
    const rest = payload.slice(notifyPrefix.length);
    const separatorIndex = rest.indexOf(";");
    const title = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
    const body = separatorIndex === -1 ? undefined : rest.slice(separatorIndex + 1);
    return { title: emptyToUndefined(title), body: body === undefined ? undefined : emptyToUndefined(body) };
  }
  return null;
}

/** Scans `text` for every complete OSC 9 / OSC 777 notify sequence it
 * contains, in order, skipping any other OSC sequence (e.g. a window-title
 * OSC 0/2) it encounters along the way. */
function scanAttentionSignals(text: string): ScanResult {
  const notifications: AttentionNotification[] = [];
  let cursor = 0;

  for (;;) {
    const start = text.indexOf(OSC, cursor);
    if (start === -1) return { notifications, remainder: "" };

    const belEnd = text.indexOf(BEL, start);
    const stEnd = text.indexOf(ST, start);
    const candidates = [belEnd, stEnd].filter((index) => index !== -1);
    if (candidates.length === 0) {
      // No terminator found yet — an incomplete trailing sequence, handed
      // back as the remainder instead of being discarded, unless it's
      // grown implausibly long for a real notify payload (see
      // `MAX_PENDING_LENGTH`), in which case it's dropped as noise rather
      // than kept growing forever.
      const remainder = text.slice(start);
      return { notifications, remainder: remainder.length > MAX_PENDING_LENGTH ? "" : remainder };
    }
    const terminatorStart = Math.min(...candidates);
    const terminatorLength = terminatorStart === belEnd ? BEL.length : ST.length;
    const payload = text.slice(start + OSC.length, terminatorStart);
    const notification = parsePayload(payload);
    if (notification) notifications.push(notification);
    cursor = terminatorStart + terminatorLength;
  }
}

/** Parses the first complete OSC 9 / OSC 777 notify sequence out of `chunk`,
 * or `null` if none is present (including a truncated/incomplete one — this
 * single-shot form does not buffer across calls, see
 * `createAttentionSignalBuffer` for that). */
export function detectAttentionNotification(chunk: string): AttentionNotification | null {
  return scanAttentionSignals(chunk).notifications[0] ?? null;
}

export interface AttentionSignalBuffer {
  /** Feeds one more chunk of raw terminal output, returning every complete
   * notify sequence found — across this call and any incomplete sequence
   * left over from the previous one. */
  feed(chunk: string): AttentionNotification[];
}

/** Stateful wrapper around `scanAttentionSignals` for a live output stream
 * (one instance per terminal shell execution): a notify sequence can land
 * split across two separate `read()` chunks, so an incomplete trailing `ESC
 * ]` is buffered and prepended to the next chunk instead of being lost. */
export function createAttentionSignalBuffer(): AttentionSignalBuffer {
  let pending = "";
  return {
    feed(chunk: string): AttentionNotification[] {
      const { notifications, remainder } = scanAttentionSignals(pending + chunk);
      pending = remainder;
      return notifications;
    },
  };
}

/** Per-project-root attention state — which panes have an unacknowledged
 * notification, and what it said (for the badge tooltip). Mirrors the
 * parse/track split already used by gitStatus.ts (pure parsing) +
 * gitDecorationProvider.ts (the cache the provider reads from). */
export class AttentionTracker {
  private readonly byRoot = new Map<string, AttentionNotification>();

  markAttention(root: string, notification: AttentionNotification = {}): void {
    this.byRoot.set(root, notification);
  }

  clearAttention(root: string): void {
    this.byRoot.delete(root);
  }

  hasAttention(root: string): boolean {
    return this.byRoot.has(root);
  }

  /** The notification content last marked for `root`, or `undefined` if it
   * has no pending attention — used for the badge's tooltip. */
  attentionFor(root: string): AttentionNotification | undefined {
    return this.byRoot.get(root);
  }

  /** Every root currently pending, oldest signal first — for the
   * Needs-Attention queue view. `Map` preserves insertion order and
   * `markAttention`'s `Map.set` on an already-present key does not move it,
   * so re-marking an already-queued root updates its notification without
   * changing its position here (.scratch/attention-queue ticket 01). */
  orderedQueue(): { root: string; notification: AttentionNotification }[] {
    return [...this.byRoot.entries()].map(([root, notification]) => ({ root, notification }));
  }
}
