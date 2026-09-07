// Pure redaction/sanitization helpers shared by every log sink. No `vscode`
// import — reachable directly from vitest, same isolation convention as
// gitStatus.ts/jsonHookPatch.ts. Centralizing this here (rather than at each
// call site) is what makes "sensitive data is never logged" a single,
// testable property instead of a convention every caller has to remember.

/** Strips control characters (including newlines/CR/tab) that a value under
 * an attacker's or another program's control (a terminal title, a file
 * name, a git branch name, a CLI tool's own output) could otherwise use to
 * forge additional log lines or corrupt the output channel/Sentry event —
 * the log-injection defense OWASP's logging guidance calls for. Also caps
 * length so one oversized value can't dominate a log line or a Sentry
 * event's payload. */
export function sanitizeLogValue(value: string, maxLength = 500): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control chars to strip them
  const stripped = value.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ").trim();
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength)}…[truncated]` : stripped;
}

/** Replaces every occurrence of `home` with `~`, so a logged absolute path
 * doesn't embed the OS username baked into `/Users/<name>/...` /
 * `/home/<name>/...`. Applied to every string value that passes through a
 * `Logger`, since PaneCrew logs plenty of absolute project/file paths by
 * necessity (that's the whole point of a diagnostic log for a file
 * explorer). */
export function redactHomeDir(value: string, home: string): string {
  if (!home) return value;
  return value.split(home).join("~");
}

// Best-effort masking for values that look like a credential even though no
// PaneCrew code path is expected to log one intentionally — defense in
// depth against a secret leaking into a message via, e.g., an error
// message a called tool (git, gh) happened to include one in.
const SECRET_PATTERNS: RegExp[] = [
  /\b((?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*)\S+/gi,
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /\bsk-[A-Za-z0-9]{10,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (text, pattern) =>
      text.replace(pattern, (...args: unknown[]) => {
        const prefix = args[1];
        return typeof prefix === "string" ? `${prefix}[REDACTED]` : "[REDACTED]";
      }),
    value,
  );
}

/** The one function every log message/context value flows through before
 * it reaches any sink: strip control chars + cap length, mask the home
 * directory (when known), mask anything that looks like a credential. */
export function sanitizeForLog(value: string, home?: string): string {
  let result = sanitizeLogValue(value);
  if (home) result = redactHomeDir(result, home);
  return redactSecrets(result);
}
