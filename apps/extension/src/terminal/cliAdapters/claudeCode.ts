// Pure `.claude/settings.json` (project-level — where Claude Code itself
// looks first) hook patcher — .scratch/pane-attention-notifications ticket
// 04. Delegates the actual merge/idempotency logic to jsonHookPatch.ts,
// which Claude Code and Gemini CLI both share.
import { patchNotificationHook, type PatchResult } from "./jsonHookPatch";

export type { PatchResult };

const MALFORMED_MESSAGE =
  "PaneCrew: .claude/settings.json is not valid JSON — fix it manually before configuring notifications.";

/** Emits the OSC 9 notify sequence `attentionSignal.ts` listens for,
 * straight to the terminal's own tty — not stdout, since a hook's stdout is
 * captured by Claude Code itself rather than forwarded to the terminal.
 * `2>/dev/null || true` keeps this a no-op (not a hook error) when there's
 * no controlling terminal to write to, e.g. a headless/background session
 * with no /dev/tty. */
export const CLAUDE_CODE_NOTIFY_COMMAND =
  "printf '\\033]9;Claude Code needs your attention\\007' > /dev/tty 2>/dev/null || true";

/** Same OSC 9 emit, wired to the `Stop` hook — fires when Claude Code
 * finishes a turn, not just when it's waiting on a permission/idle prompt.
 * Without this, a pane that never needed a permission never gets an
 * attention badge even though the user's turn (human-in-the-loop) has
 * come. */
export const CLAUDE_CODE_STOP_COMMAND =
  "printf '\\033]9;Claude Code is done\\007' > /dev/tty 2>/dev/null || true";

export function computePatchedConfig(existingConfigText: string | undefined): PatchResult {
  const afterNotification = patchNotificationHook(existingConfigText, CLAUDE_CODE_NOTIFY_COMMAND, MALFORMED_MESSAGE);
  const afterStop = patchNotificationHook(afterNotification.text, CLAUDE_CODE_STOP_COMMAND, MALFORMED_MESSAGE, "Stop");
  return { text: afterStop.text, changed: afterNotification.changed || afterStop.changed };
}
