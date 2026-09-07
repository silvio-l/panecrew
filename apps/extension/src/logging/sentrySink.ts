// Opt-in `LogSink` that forwards warn/error entries to Sentry — see
// docs/logging.md for the consent model (off by default; requires both
// `panecrew.diagnostics.errorReporting` and VS Code's own
// `telemetry.telemetryLevel` to allow it). Never forwards `context` values
// verbatim beyond what `createLogger` already sanitized, never sends
// trace/debug/info (those can carry ordinary file/project names at a
// volume no error-tracking quota should absorb), and both rate-limits and
// dedupes so a repeating failure (e.g. a git-status poll erroring every
// few seconds) can't exhaust the shared org-wide Sentry quota on its own.
import type { LogEntry, LogSink } from "./logger";
import { buildEnvelope, parseDsn, sendEnvelope, type ParsedDsn } from "./sentryTransport";

export interface SentrySinkOptions {
  dsn: string;
  release: string;
  environment: string;
  /** Hard ceiling on events sent per rolling minute — default chosen so one
   * misbehaving session can't meaningfully dent a 5,000/month org quota
   * shared across every one of the author's projects. */
  maxEventsPerMinute?: number;
  /** Same (component, message) pair is sent at most once per this many ms
   * — default 5 minutes, long enough to collapse a poll-loop's repeated
   * failure into one Sentry event instead of one per tick. */
  dedupeWindowMs?: number;
  now?: () => number;
  send?: (dsn: ParsedDsn, body: string) => void;
  eventId?: () => string;
}

function defaultEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

/** `undefined` when `dsn` doesn't parse — callers should treat that as "no
 * Sentry sink", not throw, since a malformed/missing DSN must never block
 * the rest of the extension from activating. */
export function createSentrySink(options: SentrySinkOptions): LogSink | undefined {
  const dsn = parseDsn(options.dsn);
  if (!dsn) return undefined;

  const maxEventsPerMinute = options.maxEventsPerMinute ?? 10;
  const dedupeWindowMs = options.dedupeWindowMs ?? 5 * 60_000;
  const now = options.now ?? (() => Date.now());
  const send = options.send ?? ((target, body) => { sendEnvelope(target, body); });
  const eventId = options.eventId ?? defaultEventId;

  let windowStart = now();
  let sentInWindow = 0;
  const lastSentAt = new Map<string, number>();

  return {
    emit(entry: LogEntry) {
      if (entry.level !== "warn" && entry.level !== "error") return;

      const t = now();
      if (t - windowStart >= 60_000) {
        windowStart = t;
        sentInWindow = 0;
      }
      if (sentInWindow >= maxEventsPerMinute) return;

      const dedupeKey = `${entry.component}:${entry.message}`;
      const last = lastSentAt.get(dedupeKey);
      if (last !== undefined && t - last < dedupeWindowMs) return;
      lastSentAt.set(dedupeKey, t);
      sentInWindow += 1;

      const body = buildEnvelope(
        dsn,
        {
          message: entry.message,
          level: entry.level === "error" ? "error" : "warning",
          environment: options.environment,
          release: options.release,
          tags: { component: entry.component },
          exception: entry.error ? { type: entry.error.name, value: entry.error.message } : undefined,
        },
        eventId(),
        new Date(t).toISOString(),
      );
      send(dsn, body);
    },
  };
}
