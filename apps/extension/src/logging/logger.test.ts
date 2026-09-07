import { describe, expect, it } from "vitest";
import { combineSinks, createLogger, type LogEntry, type LogSink } from "./logger";

function collectingSink(): { sink: LogSink; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { sink: { emit: (entry) => entries.push(entry) }, entries };
}

describe("createLogger", () => {
  it("tags every entry with the given component", () => {
    const { sink, entries } = collectingSink();
    createLogger(sink, "extension").info("hello");
    expect(entries[0]?.component).toBe("extension");
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.message).toBe("hello");
  });

  it("child() nests the component path", () => {
    const { sink, entries } = collectingSink();
    createLogger(sink, "extension").child("fileOperations").warn("careful");
    expect(entries[0]?.component).toBe("extension.fileOperations");
  });

  it("wraps a non-Error thrown value into an Error for .error()", () => {
    const { sink, entries } = collectingSink();
    createLogger(sink, "x").error("boom", "just a string");
    expect(entries[0]?.error).toBeInstanceOf(Error);
    expect(entries[0]?.error?.message).toBe("just a string");
  });

  it("passes a real Error through unchanged", () => {
    const { sink, entries } = collectingSink();
    const original = new Error("real failure");
    createLogger(sink, "x").error("boom", original);
    expect(entries[0]?.error).toBe(original);
  });

  it("omits error when none was given", () => {
    const { sink, entries } = collectingSink();
    createLogger(sink, "x").error("boom");
    expect(entries[0]?.error).toBeUndefined();
  });

  it("sanitizes the message and every string context value", () => {
    const { sink, entries } = collectingSink();
    createLogger(sink, "x", "/Users/silvio").info("read /Users/silvio/proj\nfake line", {
      path: "/Users/silvio/proj/secret\ntoken=abc123def456",
      count: 3,
    });
    expect(entries[0]?.message).toBe("read ~/proj fake line");
    expect(entries[0]?.context?.path).toBe("~/proj/secret token=[REDACTED]");
    expect(entries[0]?.context?.count).toBe(3);
  });

  it("drops undefined context values instead of stringifying them", () => {
    const { sink, entries } = collectingSink();
    createLogger(sink, "x").info("msg", { present: "yes", missing: undefined });
    expect(entries[0]?.context).toEqual({ present: "yes", missing: undefined });
  });
});

describe("combineSinks", () => {
  it("fans one entry out to every sink", () => {
    const a = collectingSink();
    const b = collectingSink();
    createLogger(combineSinks(a.sink, b.sink), "x").info("hi");
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(1);
  });
});
