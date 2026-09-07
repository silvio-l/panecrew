# Logging

PaneCrew has one structured logger (`src/logging/`), used everywhere instead of
ad-hoc `console.log`/`outputChannel.appendLine` calls. It has two sinks:

1. **The "PaneCrew" output channel** — always on, local-only, this is the
   primary debugging tool.
2. **Sentry** — opt-in, off by default, reports warning/error events only.

## Where logs go / how to see them

Every log line goes to VS Code's **"PaneCrew" output channel**
(View → Output → select "PaneCrew" from the dropdown, or run "PaneCrew" from
the Command Palette's "Output: Focus on Output View"). It's a real
`vscode.LogOutputChannel`, not a plain text channel, which is what gives us
everything below for free instead of having to build it:

- Every line is timestamped and colored by level automatically.
- **Log level is configurable per session** via the Command Palette:
  "Developer: Set Log Level…" → "PaneCrew" → pick Trace/Debug/Info/Warning/
  Error/Off. Defaults to VS Code's global log level (normally Info), so a
  normal session shows activation, state-changing actions, and errors —
  not per-poll-tick noise.
- **Persisted to disk** under VS Code's own logs folder — `Help → Open Logs
  Folder`, then `window<N>/exthost/output_logging_<...>/`. VS Code itself
  rotates this: each window session gets a fresh timestamped folder, and old
  sessions are pruned automatically by VS Code (not by PaneCrew) — no custom
  rotation/retention code needed here, matching the project's
  "prefer platform mechanisms" default. Nothing PaneCrew logs is ever kept
  anywhere PaneCrew itself controls or grows unbounded.

## Levels — what goes where

| Level | Use for | On by default? |
|---|---|---|
| `error` | An operation didn't complete, or a bug's consequence. Always includes the real `Error`/stack. | Yes |
| `warn` | PaneCrew recovered from something unexpected on its own. | Yes |
| `info` | A notable, bounded-frequency state change or completed action: activation, a preset saved/loaded/deleted, a folder added/removed, a CLI adapter config written, a terminal restarted/adopted/closed. | Yes |
| `debug` | Diagnostic detail too frequent for normal operation (e.g. one line per terminal-shell-execution, per layout apply) — the level to turn on when reproducing a specific bug report. | No |
| `trace` | Reserved for future very-high-volume detail. | No |

Deliberately **not** logged at all: git-status/PR-status polling failures
(`gitStatus.ts`/`forgeStatus.ts`) — a folder simply not being a git repo, or
`gh` not being installed, is the *expected* common case for a tool-agnostic
file explorer, not a diagnostic event.

## Sensitive data

Every string that reaches a log line — the message and every string context
value — passes through `src/logging/redact.ts` before it reaches any sink
(`src/logging/logger.ts`'s `createLogger`, unconditionally, so no call site
can opt out by accident):

- **Log-injection guard**: control characters and newlines are stripped, so a
  file/terminal/branch name under another program's control can't forge
  extra log lines.
- **Length cap**: 500 chars, so one oversized value can't dominate a line.
- **Home-directory masking**: every `/Users/<name>/...` path is rewritten to
  `~/...` (the logger is constructed with `os.homedir()`), so a logged
  absolute path never carries the OS username.
- **Credential masking**: `token=`/`password=`/`Bearer …`/`sk-…`/`ghp_…`-shaped
  substrings are replaced with `[REDACTED]` — defense in depth, since no
  PaneCrew code path is expected to log a real secret in the first place.

What is **never** logged, by design (not filtered after the fact — simply
never passed to the logger): full file contents, terminal/PTY output,
search results, or the content of a CLI tool's config file PaneCrew writes
(`configureNotifications.ts` logs which tool/path was touched, never the
patched JSON/TOML text).

## Sentry (opt-in error reporting)

Off by default. Turning it on requires **both**:

1. `panecrew.diagnostics.errorReporting: true` (VS Code setting, PaneCrew's
   own opt-in).
2. VS Code's own `telemetry.telemetryLevel` allowing telemetry
   (`vscode.env.isTelemetryEnabled`) — a user who disabled telemetry
   editor-wide is never enrolled by PaneCrew's setting alone.

Both are re-checked on activation; toggling the setting takes effect after
"Developer: Reload Window".

**What's sent, when on**: only `warn`/`error`-level log entries — the same
sanitized `message` the output channel shows, a `component` tag, and (for
`error`) the exception's type/message. Never the raw `context` object, never
file/project paths beyond what's already in the sanitized message, never PII.

**Why a hand-rolled client instead of `@sentry/node`**: PaneCrew ships as a
bundled, zero-runtime-dependency extension (esbuild bundles everything into
one `dist/extension.js`); `@sentry/node` pulls in tracing/profiling/Node
instrumentation for a feature that only needs "POST an error event
occasionally". `src/logging/sentryTransport.ts` implements Sentry's
documented envelope format directly over `node:https` — a few dozen lines,
fully unit-tested, no dependency added.

**Quota protection**: PaneCrew shares one Sentry org-wide quota across every
project the author runs (5,000 events/month, Developer plan). The Sentry
sink (`src/logging/sentrySink.ts`) rate-limits to 10 events/minute and
dedupes identical (component, message) pairs for 5 minutes, so one
repeating failure (e.g. a poll loop erroring every few seconds) can't spam
the shared quota. A malformed/missing DSN silently disables the sink rather
than throwing — Sentry reporting failing must never block activation or any
other feature.

The DSN (`src/logging/sentryConfig.ts`) is a public identifier, not a
secret — see
[Sentry's DSN explainer](https://docs.sentry.io/product/sentry-basics/dsn-explainer/)
— baking it into the published bundle is Sentry's own standard setup for
client/extension SDKs; it only authorizes sending events into PaneCrew's own
Sentry project, and does nothing unless a user opts in as above.

## Debugging a specific report with this

1. Ask the reporter (or reproduce yourself) with the log level turned up:
   Command Palette → "Developer: Set Log Level…" → "PaneCrew" → Debug (or
   Trace once anything needs it).
2. Reproduce the issue.
3. Open the "PaneCrew" output channel and read/copy the relevant lines —
   every line already carries a `component` tag (e.g. `[panecrew.layout]`,
   `[panecrew.fileOperations]`) so it's traceable to source, and every
   `error` line includes the real stack trace.
4. Turn the level back down (or leave it — it only affects this session's
   memory/CPU cost negligibly, never disk growth beyond VS Code's own
   rotated log files).

### Worked example: "Needs-Attention never shows anything"

The pane/terminal-tracking and attention-signal pipeline is the two most
report-prone areas, so they log the most at `debug`:

- `src/grid/layoutController.ts` logs every terminal-tracking decision —
  reused existing terminal, adopted a live one (and whether it matched by
  cwd or by name), or had to create a fresh one — plus every `forgetPane`/
  `restartTerminalForPane` call. This is what to read when a pane's tab
  stops being recognized as a PaneCrew tab, at startup or mid-session.
- `src/extension.ts`'s `onDidStartTerminalShellExecution` handler logs, per
  shell command run in a tracked pane: that it started tracking, and — once
  the command finishes — whether it read **zero output chunks at all**
  (shell integration for that terminal never activated — a VS Code/shell
  problem, not a PaneCrew bug) vs. **output but no recognized OSC 9/777
  sequence** (the CLI tool's notify hook isn't actually configured/firing —
  check `panecrew.configureCliToolNotifications`'s target file was really
  written, e.g. `.claude/settings.json`'s `hooks.Notification`/`hooks.Stop`
  entries, and that the running CLI tool version still uses that hook
  shape).

Turning Debug on and reproducing tells apart these three failure points
that all look identical as "nothing ever badges" from the outside.

## Testing

`src/logging/*.test.ts` (vitest, `pnpm --dir apps/extension run test:unit`)
covers: redaction (log-injection stripping, home-dir masking, secret
masking), the logger core (component tagging, `child()`, error
normalization, sanitization applied to every context value), Sentry envelope
building/DSN parsing, and the Sentry sink's level gating, rate limiting, and
deduplication.
