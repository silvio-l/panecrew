// Shared pure JSON-hook-patching logic for CLI tools whose notification hook
// is a `{ hooks: { Notification: [ { hooks: [ { type, command } ] } ] } }`
// settings.json shape — Claude Code and Gemini CLI both use exactly this
// shape (verified against each tool's current docs at implementation time),
// so both adapters call this one function instead of duplicating the merge
// logic. No `vscode` import: reachable directly from vitest, same isolation
// as terminalLinkDetect.ts/gitStatus.ts.

export interface PatchResult {
  text: string;
  changed: boolean;
}

interface HookEntry {
  type: string;
  command: string;
  [key: string]: unknown;
}

interface HookGroup {
  hooks?: HookEntry[];
  [key: string]: unknown;
}

interface HookedSettings {
  hooks?: Record<string, HookGroup[] | undefined>;
  [key: string]: unknown;
}

function alreadyConfigured(groups: HookGroup[], notifyCommand: string): boolean {
  return groups.some((group) => (group.hooks ?? []).some((hook) => hook.command === notifyCommand));
}

/** Adds/merges `notifyCommand` into the `Notification` hook array,
 * preserving every other setting/hook untouched, and idempotent —
 * `patchNotificationHook(patchNotificationHook(x, cmd, msg).text, cmd, msg)`
 * behaves like the first call. Throws `malformedMessage` if
 * `existingConfigText` is present but not valid JSON, so the caller (the
 * on-demand command) can surface a clear error instead of silently
 * no-opping or corrupting the file. */
export function patchNotificationHook(
  existingConfigText: string | undefined,
  notifyCommand: string,
  malformedMessage: string,
): PatchResult {
  const trimmed = existingConfigText?.trim();
  let settings: HookedSettings;
  if (!trimmed) {
    settings = {};
  } else {
    try {
      settings = JSON.parse(trimmed) as HookedSettings;
    } catch {
      throw new Error(malformedMessage);
    }
  }

  const hooks = settings.hooks ?? {};
  const notification = hooks.Notification ?? [];

  if (alreadyConfigured(notification, notifyCommand)) {
    return { text: `${JSON.stringify(settings, null, 2)}\n`, changed: false };
  }

  const patched: HookedSettings = {
    ...settings,
    hooks: {
      ...hooks,
      Notification: [...notification, { hooks: [{ type: "command", command: notifyCommand }] }],
    },
  };

  return { text: `${JSON.stringify(patched, null, 2)}\n`, changed: true };
}
