import { describe, test, expect, vi, afterEach } from "vitest";
import { createConsoleSink } from "./consoleSink";
import type { LogEntry } from "./logger";

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: "debug",
    component: "panecrew.test",
    message: "hello",
    timestamp: 0,
    ...overrides,
  };
}

describe("createConsoleSink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("routes each level to the matching console method, formatted as [component] message", () => {
    const trace = vi.spyOn(console, "trace").mockImplementation(() => undefined);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sink = createConsoleSink();

    sink.emit(entry({ level: "trace", message: "a" }));
    sink.emit(entry({ level: "debug", message: "b" }));
    sink.emit(entry({ level: "info", message: "c" }));
    sink.emit(entry({ level: "warn", message: "d" }));
    sink.emit(entry({ level: "error", message: "e" }));

    expect(trace).toHaveBeenCalledWith("[panecrew.test] a");
    expect(debug).toHaveBeenCalledWith("[panecrew.test] b");
    expect(info).toHaveBeenCalledWith("[panecrew.test] c");
    expect(warn).toHaveBeenCalledWith("[panecrew.test] d");
    expect(error).toHaveBeenCalledWith("[panecrew.test] e");
  });

  test("passes the real Error object through on error entries, for a real stack trace in the console", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sink = createConsoleSink();
    const boom = new Error("boom");

    sink.emit(entry({ level: "error", message: "failed", error: boom }));

    expect(error).toHaveBeenCalledWith("[panecrew.test] failed", boom);
  });

  test("includes context key=value pairs in the formatted line", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const sink = createConsoleSink();

    sink.emit(entry({ context: { paneId: "p1", count: 3 } }));

    expect(debug).toHaveBeenCalledWith("[panecrew.test] hello paneId=p1 count=3");
  });
});
