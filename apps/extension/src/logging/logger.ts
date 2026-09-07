// Framework-agnostic structured logger core. No `vscode` import — the
// `vscode.LogOutputChannel` adapter lives in outputChannelSink.ts, and the
// Sentry adapter in sentrySink.ts; both just implement `LogSink` against
// this module's `LogEntry` shape. Kept separate so the sanitization
// guarantee below is unit-testable without an extension host.
import { sanitizeForLog } from "./redact";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

type LogContextValue = string | number | boolean | undefined;
type LogContext = Record<string, LogContextValue>;

export interface LogEntry {
  readonly level: LogLevel;
  /** Dot-separated component path, e.g. "extension.fileOperations". */
  readonly component: string;
  readonly message: string;
  readonly context?: LogContext;
  readonly error?: Error;
  readonly timestamp: number;
}

export interface LogSink {
  emit(entry: LogEntry): void;
}

/** Renders a `LogEntry` as one text line (`[component] message key=val …`) —
 * shared by every text-based sink (the output channel, the dev-mode console
 * sink) so the two stay identically formatted rather than drifting. */
export function formatLogLine(entry: LogEntry): string {
  if (!entry.context) return `[${entry.component}] ${entry.message}`;
  const parts = Object.entries(entry.context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  const context = parts.length > 0 ? ` ${parts.join(" ")}` : "";
  return `[${entry.component}] ${entry.message}${context}`;
}

export interface Logger {
  /** Very high-volume, "what exactly happened" detail — off by default in
   * production (VS Code's own per-channel log level gates this), on when
   * actively diagnosing an issue. */
  trace(message: string, context?: LogContext): void;
  /** Diagnostic detail useful for root-causing a report, but too frequent
   * for normal operation (e.g. one line per poll tick) — off by default. */
  debug(message: string, context?: LogContext): void;
  /** Notable state changes and completed actions a normal session produces
   * a reasonable, bounded number of (activation, a preset saved, a session
   * restored) — on by default. */
  info(message: string, context?: LogContext): void;
  /** Something unexpected that PaneCrew recovered from on its own (a
   * best-effort integration failed, falling back to a safe default). */
  warn(message: string, context?: LogContext): void;
  /** An operation the user asked for did not complete, or a bug's
   * consequence — always logged, and (when the user opted in) reported to
   * Sentry with a stack trace for root-cause analysis. */
  error(message: string, error?: unknown, context?: LogContext): void;
  /** Returns a logger tagged with `${this component}.${component}` — every
   * module gets its own child logger so log lines are traceable to their
   * source without a repeated string literal at every call site. */
  child(component: string): Logger;
}

function sanitizeContext(context: LogContext | undefined, home: string | undefined): LogContext | undefined {
  if (!context) return undefined;
  const result: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = typeof value === "string" ? sanitizeForLog(value, home) : value;
  }
  return result;
}

/** Normalizes whatever a `catch` block caught into a real `Error` — a
 * thrown string/object still gets a stack-trace-bearing `Error` wrapper
 * rather than being dropped, and its stringification is sanitized the same
 * as any other log value. */
function stringifyThrown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const stringified: unknown = JSON.stringify(value);
    return typeof stringified === "string" ? stringified : "[unserializable value]";
  } catch {
    return "[unserializable value]";
  }
}

function toError(value: unknown): Error | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Error) return value;
  return new Error(sanitizeForLog(stringifyThrown(value)));
}

/** `homeDir` (typically `os.homedir()`), when provided, is masked out of
 * every logged string — see redact.ts. Optional so pure unit tests can
 * exercise a logger without caring about the host's home directory. */
export function createLogger(sink: LogSink, component: string, homeDir?: string): Logger {
  function emit(level: LogLevel, message: string, context: LogContext | undefined, error?: unknown): void {
    sink.emit({
      level,
      component,
      message: sanitizeForLog(message, homeDir),
      context: sanitizeContext(context, homeDir),
      error: toError(error),
      timestamp: Date.now(),
    });
  }

  return {
    trace: (message, context) => { emit("trace", message, context); },
    debug: (message, context) => { emit("debug", message, context); },
    info: (message, context) => { emit("info", message, context); },
    warn: (message, context) => { emit("warn", message, context); },
    error: (message, error, context) => { emit("error", message, context, error); },
    child: (component_) => createLogger(sink, `${component}.${component_}`, homeDir),
  };
}

/** Fans one `LogEntry` out to every given sink — used to wire the always-on
 * output-channel sink together with the opt-in Sentry sink without either
 * one knowing the other exists. */
export function combineSinks(...sinks: LogSink[]): LogSink {
  return {
    emit(entry) {
      for (const sink of sinks) sink.emit(entry);
    },
  };
}
