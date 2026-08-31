import { describe, expect, it } from "vitest";
import { AttentionTracker, createAttentionSignalBuffer, detectAttentionNotification } from "./attentionSignal";

describe("detectAttentionNotification", () => {
  it("parses OSC 9 terminated by BEL", () => {
    expect(detectAttentionNotification("\x1b]9;Task finished\x07")).toEqual({
      body: "Task finished",
    });
  });

  it("parses OSC 9 terminated by ST", () => {
    expect(detectAttentionNotification("\x1b]9;Task finished\x1b\\")).toEqual({
      body: "Task finished",
    });
  });

  it("parses OSC 777 notify with title and body, terminated by BEL", () => {
    expect(detectAttentionNotification("\x1b]777;notify;Claude Code;Waiting for input\x07")).toEqual({
      title: "Claude Code",
      body: "Waiting for input",
    });
  });

  it("parses OSC 777 notify terminated by ST", () => {
    expect(detectAttentionNotification("\x1b]777;notify;Claude Code;Waiting for input\x1b\\")).toEqual({
      title: "Claude Code",
      body: "Waiting for input",
    });
  });

  it("finds the sequence embedded in surrounding terminal output", () => {
    const chunk = "some prompt output\x1b]9;Done\x07more output after";
    expect(detectAttentionNotification(chunk)).toEqual({ body: "Done" });
  });

  it("returns null for plain text with no escape sequence", () => {
    expect(detectAttentionNotification("just some regular terminal output")).toBeNull();
  });

  it("returns null for an unrelated OSC sequence (e.g. window title)", () => {
    expect(detectAttentionNotification("\x1b]0;my-shell — bash\x07")).toBeNull();
  });

  it("returns null for a truncated/incomplete sequence (no terminator yet)", () => {
    expect(detectAttentionNotification("\x1b]777;notify;Claude Code;Waiting")).toBeNull();
  });

  it("returns null for a malformed OSC 777 payload missing the notify subcommand", () => {
    expect(detectAttentionNotification("\x1b]777;Waiting\x07")).toBeNull();
  });

  it("returns an empty object for an OSC 9 sequence with no message", () => {
    expect(detectAttentionNotification("\x1b]9;\x07")).toEqual({});
  });
});

describe("createAttentionSignalBuffer", () => {
  it("finds a sequence that arrives in a single chunk", () => {
    const buffer = createAttentionSignalBuffer();
    expect(buffer.feed("\x1b]9;Done\x07")).toEqual([{ body: "Done" }]);
  });

  it("finds a sequence split across two chunks at the escape introducer", () => {
    const buffer = createAttentionSignalBuffer();
    expect(buffer.feed("some output ")).toEqual([]);
    expect(buffer.feed("\x1b]9;Done\x07")).toEqual([{ body: "Done" }]);
  });

  it("finds a sequence whose payload is split mid-way across chunks", () => {
    const buffer = createAttentionSignalBuffer();
    expect(buffer.feed("\x1b]777;notify;Claude Code;Wait")).toEqual([]);
    expect(buffer.feed("ing for input\x07")).toEqual([
      { title: "Claude Code", body: "Waiting for input" },
    ]);
  });

  it("finds a sequence whose terminator is split across chunks", () => {
    const buffer = createAttentionSignalBuffer();
    expect(buffer.feed("\x1b]9;Done\x1b")).toEqual([]);
    expect(buffer.feed("\\")).toEqual([{ body: "Done" }]);
  });

  it("finds multiple sequences across several feeds", () => {
    const buffer = createAttentionSignalBuffer();
    expect(buffer.feed("\x1b]9;First\x07")).toEqual([{ body: "First" }]);
    expect(buffer.feed("in between\x1b]9;Second\x07")).toEqual([{ body: "Second" }]);
  });

  it("finds multiple sequences within a single chunk", () => {
    const buffer = createAttentionSignalBuffer();
    expect(buffer.feed("\x1b]9;First\x07 and \x1b]9;Second\x07")).toEqual([
      { body: "First" },
      { body: "Second" },
    ]);
  });

  it("keeps buffering a short incomplete sequence across several feeds", () => {
    const buffer = createAttentionSignalBuffer();
    expect(buffer.feed("\x1b]9;never terminated")).toEqual([]);
    expect(buffer.feed(" still nothing")).toEqual([]);
  });

  // 2026-08-28 memory-growth incident: a real notify payload is short, so an
  // `ESC ]` sequence that never finds a BEL/ST terminator (e.g. a stray
  // byte pair inside raw/binary output piped through the terminal) must not
  // be allowed to accumulate every subsequent chunk forever -- that grew
  // unbounded for the life of a long-running shell command in practice.
  it("drops an incomplete sequence instead of growing forever once it gets implausibly long", () => {
    const buffer = createAttentionSignalBuffer();
    expect(buffer.feed("\x1b]9;")).toEqual([]);
    // Feed far more than a real notify payload could plausibly be.
    for (let i = 0; i < 10; i++) {
      expect(buffer.feed("x".repeat(1000))).toEqual([]);
    }
    // The stale, oversized pending sequence was dropped -- a genuine
    // notify sequence arriving afterwards is still detected normally,
    // proving the buffer recovered rather than staying stuck.
    expect(buffer.feed("\x1b]9;Done\x07")).toEqual([{ body: "Done" }]);
  });
});

describe("AttentionTracker", () => {
  it("has no attention for a root that was never marked", () => {
    const tracker = new AttentionTracker();
    expect(tracker.hasAttention("/repo/a")).toBe(false);
    expect(tracker.attentionFor("/repo/a")).toBeUndefined();
  });

  it("marks and reports attention for a root", () => {
    const tracker = new AttentionTracker();
    tracker.markAttention("/repo/a", { title: "Claude Code", body: "Waiting" });
    expect(tracker.hasAttention("/repo/a")).toBe(true);
    expect(tracker.attentionFor("/repo/a")).toEqual({ title: "Claude Code", body: "Waiting" });
  });

  it("clears attention for a root", () => {
    const tracker = new AttentionTracker();
    tracker.markAttention("/repo/a");
    tracker.clearAttention("/repo/a");
    expect(tracker.hasAttention("/repo/a")).toBe(false);
  });

  it("tracks multiple roots independently", () => {
    const tracker = new AttentionTracker();
    tracker.markAttention("/repo/a");
    tracker.markAttention("/repo/b");
    tracker.clearAttention("/repo/a");
    expect(tracker.hasAttention("/repo/a")).toBe(false);
    expect(tracker.hasAttention("/repo/b")).toBe(true);
  });

  it("clearing a root that was never marked is a no-op", () => {
    const tracker = new AttentionTracker();
    expect(() => { tracker.clearAttention("/repo/a"); }).not.toThrow();
    expect(tracker.hasAttention("/repo/a")).toBe(false);
  });

  describe("orderedQueue", () => {
    it("is empty for a fresh tracker", () => {
      expect(new AttentionTracker().orderedQueue()).toEqual([]);
    });

    it("lists marked roots oldest first", () => {
      const tracker = new AttentionTracker();
      tracker.markAttention("/repo/a", { body: "First" });
      tracker.markAttention("/repo/b", { body: "Second" });
      tracker.markAttention("/repo/c", { body: "Third" });

      expect(tracker.orderedQueue()).toEqual([
        { root: "/repo/a", notification: { body: "First" } },
        { root: "/repo/b", notification: { body: "Second" } },
        { root: "/repo/c", notification: { body: "Third" } },
      ]);
    });

    it("keeps a re-marked root's original position, only updating its notification", () => {
      const tracker = new AttentionTracker();
      tracker.markAttention("/repo/a", { body: "First" });
      tracker.markAttention("/repo/b", { body: "Second" });
      tracker.markAttention("/repo/a", { body: "First, again" });

      expect(tracker.orderedQueue()).toEqual([
        { root: "/repo/a", notification: { body: "First, again" } },
        { root: "/repo/b", notification: { body: "Second" } },
      ]);
    });

    it("removes a root from the queue once cleared", () => {
      const tracker = new AttentionTracker();
      tracker.markAttention("/repo/a");
      tracker.markAttention("/repo/b");
      tracker.clearAttention("/repo/a");

      expect(tracker.orderedQueue()).toEqual([{ root: "/repo/b", notification: {} }]);
    });
  });
});
