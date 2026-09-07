import { describe, expect, it } from "vitest";
import { buildEnvelope, parseDsn } from "./sentryTransport";

describe("parseDsn", () => {
  it("parses a well-formed DSN", () => {
    expect(parseDsn("https://publickey@o123.ingest.de.sentry.io/456")).toEqual({
      publicKey: "publickey",
      host: "o123.ingest.de.sentry.io",
      projectId: "456",
    });
  });

  it("returns undefined for an unparseable string", () => {
    expect(parseDsn("not a url")).toBeUndefined();
  });

  it("returns undefined when the public key is missing", () => {
    expect(parseDsn("https://o123.ingest.de.sentry.io/456")).toBeUndefined();
  });

  it("returns undefined when the project id is missing", () => {
    expect(parseDsn("https://publickey@o123.ingest.de.sentry.io/")).toBeUndefined();
  });
});

describe("buildEnvelope", () => {
  const dsn = { publicKey: "pk", host: "o1.ingest.de.sentry.io", projectId: "42" };

  it("produces three newline-delimited JSON lines", () => {
    const body = buildEnvelope(
      dsn,
      { message: "boom", level: "error", environment: "production", release: "1.0.0", tags: { component: "x" } },
      "eventid123",
      "2026-01-01T00:00:00.000Z",
    );
    const lines = body.trim().split("\n");
    expect(lines).toHaveLength(3);
    const [envelopeHeader, itemHeader, item] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(envelopeHeader).toMatchObject({ event_id: "eventid123", dsn: "https://pk@o1.ingest.de.sentry.io/42" });
    expect(itemHeader).toEqual({ type: "event" });
    expect(item).toMatchObject({ level: "error", environment: "production", release: "1.0.0" });
  });

  it("includes exception info when given", () => {
    const body = buildEnvelope(
      dsn,
      {
        message: "boom",
        level: "error",
        environment: "development",
        release: "0.1.0",
        tags: {},
        exception: { type: "TypeError", value: "x is not a function" },
      },
      "id",
      "2026-01-01T00:00:00.000Z",
    );
    const lines = body.trim().split("\n");
    const item = JSON.parse(lines[2] ?? "") as { exception?: { values: unknown[] } };
    expect(item.exception?.values).toEqual([{ type: "TypeError", value: "x is not a function" }]);
  });
});
