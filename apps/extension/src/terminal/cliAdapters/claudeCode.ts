// Pure `.claude/settings.json` (project-level — where Claude Code itself
// looks first) Notification-hook patcher — .scratch/pane-attention-notifications
// ticket 04. Delegates the actual merge/idempotency logic to
// jsonHookPatch.ts, which Claude Code and Gemini CLI both share.
import { patchNotificationHook, type PatchResult } from "./jsonHookPatch";

export type { PatchResult };

/** Emits the OSC 9 notify sequence `attentionSignal.ts` listens for,
 * straight to the terminal's own tty — not stdout, since a hook's stdout is
 * captured by Claude Code itself rather than forwarded to the terminal. */
export const CLAUDE_CODE_NOTIFY_COMMAND =
  "printf '\\033]9;Claude Code needs your attention\\007' > /dev/tty";

export function computePatchedConfig(existingConfigText: string | undefined): PatchResult {
  return patchNotificationHook(
    existingConfigText,
    CLAUDE_CODE_NOTIFY_COMMAND,
    "PaneCrew: .claude/settings.json is not valid JSON — fix it manually before configuring notifications.",
  );
}
