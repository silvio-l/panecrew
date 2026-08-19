import { describe, expect, it } from "vitest";
import type { SnippetCandidate } from "./snippetTrigger";
import { filterSnippetCandidates, snippetErase, snippetTrigger } from "./snippetTrigger";

// Same 40-cell padded-row shape as suggestion.test.ts — xterm.js pads a row
// to the terminal width rather than cutting it off.
const PROMPT = "~/panecrew ❯ ";
const row = (input: string) => (PROMPT + input).padEnd(40, " ");

const triggerOf = (input: string, cursorOffset = input.length) =>
  snippetTrigger({
    bufferType: "normal",
    anchor: { x: PROMPT.length, y: 3 },
    cursor: { x: PROMPT.length + cursorOffset, y: 3 },
    rowText: row(input),
  });

describe("snippetTrigger", () => {
  it("fires at input start", () => {
    expect(triggerOf("://")).toEqual({ start: PROMPT.length, filter: "" });
    expect(triggerOf("://ini")).toEqual({ start: PROMPT.length, filter: "ini" });
  });

  it("fires right after a space, mid-sentence", () => {
    const result = triggerOf("echo ://ini");
    expect(result).toEqual({ start: PROMPT.length + "echo ".length, filter: "ini" });
  });

  it("does not fire mid-word, e.g. inside a URL", () => {
    // The "://" sits right after "https", not after whitespace or input
    // start — the exact case this guard exists to protect.
    expect(triggerOf("https://example.com")).toBeNull();
    expect(triggerOf("https://")).toBeNull();
  });

  it("does not fire without an anchor (nothing typed yet)", () => {
    expect(
      snippetTrigger({
        bufferType: "normal",
        anchor: null,
        cursor: { x: PROMPT.length, y: 3 },
        rowText: row(""),
      }),
    ).toBeNull();
  });

  it("does not fire in the alternate screen buffer", () => {
    expect(
      snippetTrigger({
        bufferType: "alternate",
        anchor: { x: PROMPT.length, y: 3 },
        cursor: { x: PROMPT.length + 3, y: 3 },
        rowText: row("://"),
      }),
    ).toBeNull();
  });

  it("does not fire once the trigger word is finished and typing moved past it", () => {
    // Cursor sits after the trailing space, on a fresh word — the "://foo"
    // word itself is done, its own trigger no longer applies.
    expect(triggerOf("://foo ", "://foo ".length)).toBeNull();
  });

  it("does not fire when the cursor sits mid-word instead of at its end", () => {
    // Cursor after "://in" but "it" still follows on the same word.
    expect(triggerOf("://init", "://in".length)).toBeNull();
  });
});

const CANDIDATES: SnippetCandidate[] = [
  { trigger: "init", description: "Scaffold .panecrew/", kind: "command" },
  { trigger: "reload-snippets", description: "Reread snippet files", kind: "command" },
  { trigger: "commit", description: "Conventional commit template", kind: "snippet", body: "type(scope): summary\n" },
];

describe("filterSnippetCandidates", () => {
  it("returns every candidate for an empty filter", () => {
    expect(filterSnippetCandidates(CANDIDATES, "")).toEqual(CANDIDATES);
  });

  it("narrows by trigger name", () => {
    expect(filterSnippetCandidates(CANDIDATES, "init").map((c) => c.trigger)).toEqual(["init"]);
  });

  it("narrows by description text too", () => {
    expect(filterSnippetCandidates(CANDIDATES, "reread").map((c) => c.trigger)).toEqual([
      "reload-snippets",
    ]);
  });

  it("is case-insensitive", () => {
    expect(filterSnippetCandidates(CANDIDATES, "INIT").map((c) => c.trigger)).toEqual(["init"]);
  });

  it("returns nothing when no candidate matches", () => {
    expect(filterSnippetCandidates(CANDIDATES, "xyz")).toEqual([]);
  });
});

describe("snippetErase", () => {
  it("backspaces exactly the typed \"://…\" span", () => {
    expect(snippetErase({ start: 10, filter: "ini" })).toBe("\x7f".repeat(6));
  });

  it("backspaces just the bare trigger when nothing was typed after it", () => {
    expect(snippetErase({ start: 10, filter: "" })).toBe("\x7f".repeat(3));
  });
});
