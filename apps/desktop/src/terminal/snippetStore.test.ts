import { beforeEach, describe, expect, it, vi } from "vitest";
import { reloadSnippets, snippetsFor, subscribeSnippets } from "./snippetStore";
import type { SnippetCandidate } from "./snippetTrigger";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const HELLO: SnippetCandidate = {
  trigger: "hello",
  description: "Say hello",
  body: "Hello!",
  kind: "snippet",
};

// The store keeps module-level state across the whole file (same shape as
// shellHistory.ts's `pending`), so each test below uses its own project path
// to stay isolated from the others instead of resetting the module.
beforeEach(() => {
  invoke.mockReset();
});

describe("snippetsFor", () => {
  it("is empty before any reload for the project has resolved", () => {
    expect(snippetsFor("/p/never-loaded")).toEqual([]);
  });
});

describe("reloadSnippets", () => {
  it("populates snippetsFor once the read resolves", async () => {
    invoke.mockResolvedValue([{ trigger: "hello", description: "Say hello", body: "Hello!" }]);

    await reloadSnippets("/p/a");

    expect(snippetsFor("/p/a")).toEqual([HELLO]);
    expect(invoke).toHaveBeenCalledWith("snippet_list", { projectPath: "/p/a" });
  });

  it("leaves the previous list in place when the read fails", async () => {
    invoke.mockResolvedValueOnce([{ trigger: "hello", description: "Say hello", body: "Hello!" }]);
    await reloadSnippets("/p/b");

    invoke.mockRejectedValueOnce(new Error("boom"));
    await reloadSnippets("/p/b");

    expect(snippetsFor("/p/b")).toEqual([HELLO]);
  });

  it("shares one in-flight read across concurrent callers for the same project", async () => {
    let resolveInvoke: (value: unknown) => void = () => undefined;
    invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );

    const first = reloadSnippets("/p/c");
    const second = reloadSnippets("/p/c");
    resolveInvoke([]);
    await Promise.all([first, second]);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("notifies every subscriber of the same project, not just the caller", async () => {
    invoke.mockResolvedValue([{ trigger: "hello", description: "Say hello", body: "Hello!" }]);
    const callerNotified = vi.fn();
    const otherTabNotified = vi.fn();
    subscribeSnippets("/p/d", callerNotified);
    subscribeSnippets("/p/d", otherTabNotified);

    await reloadSnippets("/p/d");

    expect(callerNotified).toHaveBeenCalledTimes(1);
    expect(otherTabNotified).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a subscriber once unsubscribed", async () => {
    invoke.mockResolvedValue([]);
    const notified = vi.fn();
    const unsubscribe = subscribeSnippets("/p/e", notified);
    unsubscribe();

    await reloadSnippets("/p/e");

    expect(notified).not.toHaveBeenCalled();
  });

  it("keeps two different projects' lists independent", async () => {
    invoke.mockResolvedValueOnce([{ trigger: "hello", description: "Say hello", body: "Hello!" }]);
    await reloadSnippets("/p/f-one");
    invoke.mockResolvedValueOnce([]);
    await reloadSnippets("/p/f-two");

    expect(snippetsFor("/p/f-one")).toEqual([HELLO]);
    expect(snippetsFor("/p/f-two")).toEqual([]);
  });
});
