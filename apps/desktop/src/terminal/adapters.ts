// Ticket 35: the fixed, in-code set of CLI-tool adapters a terminal tab can
// launch with, plus the built-in login shell (represented as `null`
// everywhere an adapter id is expected — `TerminalTab.adapterId`,
// `session_store.rs::PersistedTerminalTab.adapter_id`, the
// `terminal.defaultAdapter` setting's `"shell"` option). Deliberately NOT
// the extension-registry adapter contract
// from Ticket 12 (`contributes.adapters[]`, `${projectPath}`/`${loginShell}`
// placeholders, per-platform overrides) — Ticket 35's own scope explicitly
// excludes that ("Kein Bezug zur Extension-Registry oder zu Rechten/Rights").
//
// `id`s match `toolIcons.tsx`'s `TOOL_BY_ID` keys (and `tool_detect.rs`'s
// `TOOL_MARKERS`) so the picker can reuse those icons — but this list is the
// launch-time source of truth, that one is a runtime-detection table; the id
// overlap is a deliberate convenience, not a shared source of truth.
export interface Adapter {
  id: string;
  /** The literal command typed into the freshly spawned login shell (see
   * `launchLineFor` below) — never exec'd directly as the PTY's own child
   * process. Bypasses the classic GUI-app PATH problem (a macOS `.app`
   * launched from Finder/Dock inherits a minimal system PATH, not the
   * user's shell-rc one, so a homebrew-/npm-global-installed binary like
   * `claude` would be unresolvable if this process tried to exec it // brandlint-ok: functional example of the PATH problem, not marketing
   * directly) for free, since the login shell itself resolves `PATH` via
   * the user's own rc files exactly as it would for a manually typed
   * command. */
  command: string;
}

export const ADAPTERS: readonly Adapter[] = [
  { id: "claude", command: "claude" }, // brandlint-ok: canonical adapter id, functional
  { id: "codex", command: "codex" }, // brandlint-ok: canonical adapter id, functional
  { id: "gemini", command: "gemini" }, // brandlint-ok: canonical adapter id, functional
  { id: "copilot", command: "copilot" }, // brandlint-ok: canonical adapter id, functional
  { id: "opencode", command: "opencode" },
];

/** `null` covers both "no adapter chosen" (built-in shell) and a stale
 * persisted id no longer in `ADAPTERS` (tool removed from the fixed list) —
 * both fall back to a bare shell identically, per Ticket 35's stale-id
 * acceptance criterion. */
export function resolveAdapter(adapterId: string | null): Adapter | null {
  if (adapterId === null) return null;
  return ADAPTERS.find((adapter) => adapter.id === adapterId) ?? null;
}

/** `\r` (not `\n`): what a real Enter keypress sends into a PTY — the same
 * byte `usePtyTerminal.ts`'s own line-editing/completion paths already use. */
export function launchLineFor(adapter: Adapter): string {
  return `${adapter.command}\r`;
}

/** Reads the `terminal.defaultAdapter` core setting's raw value (`useSettings`'
 * `values["terminal.defaultAdapter"]`) into an adapter id, or `null` for its
 * `"shell"` option — same `null`-means-built-in-shell convention as
 * `resolveAdapter`. Not `resolveAdapter` itself: a `"shell"` setting value is
 * a legitimate, deliberate default, not a stale/unknown id. */
export function defaultAdapterIdFromSetting(value: unknown): string | null {
  return typeof value === "string" && value !== "shell" ? value : null;
}
