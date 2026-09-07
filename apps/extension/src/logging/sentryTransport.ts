// Minimal Sentry envelope client, hand-rolled against Sentry's documented
// ingest API (https://develop.sentry.dev/sdk/data-model/envelopes/) instead
// of the official `@sentry/node` SDK. Deliberate: PaneCrew ships as a
// bundled, zero-runtime-dependency VS Code extension (esbuild bundles
// everything into dist/extension.js), and `@sentry/node` pulls in tracing,
// profiling and Node instrumentation PaneCrew doesn't need just to report
// the occasional error event — a few dozen lines of `node:https` cover the
// one thing actually wanted here. No `vscode` import — reachable from
// vitest with `send` mocked, same isolation convention as the rest of
// src/logging.
import * as https from "node:https";

export interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

/** A Sentry DSN looks like `https://<publicKey>@<host>/<projectId>`. */
export function parseDsn(dsn: string): ParsedDsn | undefined {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return undefined;
  }
  const projectId = url.pathname.replace(/^\//, "");
  if (!url.username || !projectId) return undefined;
  return { publicKey: url.username, host: url.host, projectId };
}

interface SentryExceptionInfo {
  type: string;
  value: string;
}

export interface SentryEventPayload {
  message: string;
  level: "warning" | "error";
  environment: string;
  release: string;
  tags: Record<string, string>;
  exception?: SentryExceptionInfo;
}

/** Builds the newline-delimited envelope body (envelope header, one item
 * header, one item payload) for a single error event — PaneCrew only ever
 * sends one event per envelope, so no batching support is needed. */
export function buildEnvelope(dsn: ParsedDsn, event: SentryEventPayload, eventId: string, sentAt: string): string {
  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: sentAt,
    dsn: `https://${dsn.publicKey}@${dsn.host}/${dsn.projectId}`,
  });
  const itemHeader = JSON.stringify({ type: "event" });
  const item = JSON.stringify({
    event_id: eventId,
    timestamp: sentAt,
    platform: "node",
    logger: "panecrew",
    message: { formatted: event.message },
    level: event.level,
    environment: event.environment,
    release: event.release,
    tags: event.tags,
    exception: event.exception
      ? { values: [{ type: event.exception.type, value: event.exception.value }] }
      : undefined,
  });
  return `${envelopeHeader}\n${itemHeader}\n${item}\n`;
}

/** Fire-and-forget POST — errors reporting an error must never surface to
 * the user or throw inside the extension host; `onError` is only used by
 * tests to observe the failure path. 5s timeout so a hung connection can't
 * pile up sockets under repeated failures. */
export function sendEnvelope(dsn: ParsedDsn, body: string, onError?: (error: unknown) => void): void {
  try {
    const request = https.request(
      {
        host: dsn.host,
        path: `/api/${dsn.projectId}/envelope/`,
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 5000,
      },
      (response) => {
        response.resume();
      },
    );
    request.on("error", (error) => { onError?.(error); });
    request.on("timeout", () => { request.destroy(); });
    request.end(body);
  } catch (error) {
    onError?.(error);
  }
}
