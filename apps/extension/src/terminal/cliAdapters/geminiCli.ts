// Pure `.gemini/settings.json` (project-level) Notification-hook patcher —
// .scratch/pane-attention-notifications ticket 06. Gemini CLI's hooks
// mechanism (https://geminicli.com/docs/hooks/reference/, verified at
// implementation time) uses the exact same
// `{ hooks: { Notification: [ { hooks: [ { type, command } ] } ] } }` shape
// as Claude Code's settings.json, so this delegates to the same
// jsonHookPatch.ts merge logic rather than duplicating it.
import { patchNotificationHook, type PatchResult } from "./jsonHookPatch";

export type { PatchResult };

export const GEMINI_CLI_NOTIFY_COMMAND =
  "printf '\\033]9;Gemini CLI needs your attention\\007' > /dev/tty";

export function computePatchedConfig(existingConfigText: string | undefined): PatchResult {
  return patchNotificationHook(
    existingConfigText,
    GEMINI_CLI_NOTIFY_COMMAND,
    "PaneCrew: .gemini/settings.json is not valid JSON — fix it manually before configuring notifications.",
  );
}
