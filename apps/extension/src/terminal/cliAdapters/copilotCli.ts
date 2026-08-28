// Pure `.github/hooks/panecrew-attention.json` (project-level — GitHub
// Copilot CLI loads every `*.json` file under `.github/hooks/`) hook-file
// writer — .scratch/pane-attention-notifications ticket 07. Unlike Claude
// Code/Gemini CLI's single shared settings.json, Copilot CLI hooks are
// split one-file-per-concern across a directory (verified against
// https://docs.github.com/en/copilot/reference/hooks-reference at
// implementation time), so PaneCrew gets its own dedicated file instead of
// merging into a shared one — no merge/idempotency logic needed beyond a
// whole-file compare, unlike `jsonHookPatch.ts`.

import { NOTIFY_REDIRECT_TARGET } from "./notifyTarget";

export interface PatchResult {
  text: string;
  changed: boolean;
}

/** Emits the OSC 9 notify sequence `attentionSignal.ts` listens for,
 * straight to the terminal's own tty. Wired to Copilot CLI's `notification`
 * hook, which fires when the CLI emits a system notification — e.g. a
 * permission prompt. `2>/dev/null || true` keeps this a no-op (not a hook
 * error) when there's no controlling terminal to write to, e.g. a
 * headless/background session with no /dev/tty (see `notifyTarget.ts` for
 * the Windows case). */
const COPILOT_CLI_NOTIFY_COMMAND =
  `printf '\\033]9;GitHub Copilot needs your attention\\007' > ${NOTIFY_REDIRECT_TARGET} 2>/dev/null || true`;

/** Same OSC 9 emit, wired to Copilot CLI's `agentStop` hook — fires when
 * the main agent finishes a turn, mirroring Claude Code's `Stop` hook. */
const COPILOT_CLI_STOP_COMMAND =
  `printf '\\033]9;GitHub Copilot is done\\007' > ${NOTIFY_REDIRECT_TARGET} 2>/dev/null || true`;

export const COPILOT_CLI_HOOKS_CONFIG = `${JSON.stringify(
  {
    version: 1,
    hooks: {
      notification: [{ type: "command", command: COPILOT_CLI_NOTIFY_COMMAND }],
      agentStop: [{ type: "command", command: COPILOT_CLI_STOP_COMMAND }],
    },
  },
  null,
  2,
)}\n`;

/** This is a dedicated PaneCrew-owned file (not a shared settings file to
 * merge into), so "patch" is just a whole-file compare: create/overwrite if
 * different, no-op if it already matches. */
export function computePatchedConfig(existingConfigText: string | undefined): PatchResult {
  if (existingConfigText === COPILOT_CLI_HOOKS_CONFIG) {
    return { text: existingConfigText, changed: false };
  }
  return { text: COPILOT_CLI_HOOKS_CONFIG, changed: true };
}
