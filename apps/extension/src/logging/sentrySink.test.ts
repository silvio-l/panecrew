import { describe, expect, it } from "vitest";
import { createSentrySink } from "./sentrySink";
import type { LogEntry } from "./logger";

const DSN = "https://pk@o1.ingest.de.sentry.io/42";

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: "error",
    component: "x",
    message: "boom",
    timestamp: 0,
    ...overrides,
  };
}

function mustCreateSink(...args: Parameters<typeof createSentrySink>): ReturnType<typeof createSentrySink> & object {
  const sink = createSentrySink(...args);
  if (!sink) throw new Error("expected createSentrySink to return a sink for a valid DSN");
  return sink;
}

describe("createSentrySink", () => {
  it("returns undefined for a malformed DSN instead of throwing", () => {
    expect(createSentrySink({ dsn: "not-a-dsn", release: "1.0.0", environment: "development" })).toBeUndefined();
  });

  it("only forwards warn/error entries, never trace/debug/info", () => {
    const sent: string[] = [];
    const sink = mustCreateSink({
      dsn: DSN,
      release: "1.0.0",
      environment: "development",
      send: (_dsn, body) => { sent.push(body); },
    });
    sink.emit(entry({ level: "trace", message: "t" }));
    sink.emit(entry({ level: "debug", message: "d" }));
    sink.emit(entry({ level: "info", message: "i" }));
    expect(sent).toHaveLength(0);
    sink.emit(entry({ level: "warn", message: "w" }));
    sink.emit(entry({ level: "error", message: "e" }));
    expect(sent).toHaveLength(2);
  });

  it("rate-limits to maxEventsPerMinute within a rolling window", () => {
    const sent: string[] = [];
    let now = 0;
    const sink = mustCreateSink({
      dsn: DSN,
      release: "1.0.0",
      environment: "development",
      maxEventsPerMinute: 2,
      now: () => now,
      send: (_dsn, body) => { sent.push(body); },
    });
    sink.emit(entry({ message: "a" }));
    sink.emit(entry({ message: "b" }));
    sink.emit(entry({ message: "c" }));
    expect(sent).toHaveLength(2);

    now = 61_000;
    sink.emit(entry({ message: "d" }));
    expect(sent).toHaveLength(3);
  });

  it("dedupes the same (component, message) pair within the dedupe window", () => {
    const sent: string[] = [];
    let now = 0;
    const sink = mustCreateSink({
      dsn: DSN,
      release: "1.0.0",
      environment: "development",
      dedupeWindowMs: 1000,
      now: () => now,
      send: (_dsn, body) => { sent.push(body); },
    });
    sink.emit(entry());
    sink.emit(entry());
    expect(sent).toHaveLength(1);

    now = 2000;
    sink.emit(entry());
    expect(sent).toHaveLength(2);
  });

  it("never includes the raw log context — only message, level, component tag, and exception", () => {
    const sent: string[] = [];
    const sink = mustCreateSink({
      dsn: DSN,
      release: "1.0.0",
      environment: "development",
      send: (_dsn, body) => { sent.push(body); },
    });
    sink.emit(entry({ context: { secretLookingField: "should never appear" } }));
    expect(sent[0]).not.toContain("secretLookingField");
    expect(sent[0]).not.toContain("should never appear");
  });
});
