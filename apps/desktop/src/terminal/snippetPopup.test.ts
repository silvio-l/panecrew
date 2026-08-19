import { Terminal } from "@xterm/xterm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { attachSnippetPopup } from "./snippetPopup";
import type { SnippetPopup } from "./snippetPopup";
import type { SnippetCandidate } from "./snippetTrigger";

// xterm queries the device pixel ratio via a media query on open; jsdom has
// no matchMedia (same workaround as inlineSuggestion.test.ts).
beforeAll(() => {
  window.matchMedia = (query) =>
    ({
      matches: false,
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

const FONT = { fontFamily: "monospace", fontSize: 13 };

let terminal: Terminal;
let popup: SnippetPopup;
let written: string[];
let ran: string[];
let candidates: SnippetCandidate[];

beforeEach(() => {
  const container = document.createElement("div");
  document.body.append(container);
  terminal = new Terminal({ cols: 60, rows: 10, allowProposedApi: true });
  terminal.open(container);
  written = [];
  ran = [];
  candidates = [];
  popup = attachSnippetPopup(terminal, {
    write: (text) => written.push(text),
    listCandidates: () => candidates,
    runCommand: (trigger) => ran.push(trigger),
    font: FONT,
  });
});

afterEach(() => {
  popup.dispose();
  terminal.dispose();
});

/** Types `://` plus `filter` at the start of the line and feeds it to the popup. */
function triggerAt(filter: string): void {
  popup.update({
    bufferType: "normal",
    anchor: { x: 0, y: 0 },
    cursor: { x: 3 + filter.length, y: 0 },
    rowText: `://${filter}`,
  });
}

describe("acceptSelected", () => {
  it("inserts a multi-line snippet body via terminal.paste, not as raw PTY keystrokes", () => {
    const body = "type(scope): summary\n\nWhy this change was needed.\n";
    candidates = [{ trigger: "commit", description: "Conventional commit", kind: "snippet", body }];
    triggerAt("commit");
    const paste = vi.spyOn(terminal, "paste").mockImplementation(() => undefined);

    const accepted = popup.accept();

    expect(accepted).toBe(true);
    expect(paste).toHaveBeenCalledExactlyOnceWith(body);
    // The erase (backspaces for the typed "://commit") still goes through the
    // raw write path — only the body itself must avoid being interpreted as
    // keystrokes, since an embedded "\n" would otherwise submit the line.
    expect(written).toEqual(["\x7f".repeat(3 + "commit".length)]);
    expect(written.join("")).not.toContain(body);
  });

  it("runs a command candidate instead of writing or pasting its (absent) body", () => {
    candidates = [{ trigger: "init", description: "Scaffold .panecrew/", kind: "command" }];
    triggerAt("init");
    const paste = vi.spyOn(terminal, "paste").mockImplementation(() => undefined);

    const accepted = popup.accept();

    expect(accepted).toBe(true);
    expect(ran).toEqual(["init"]);
    expect(paste).not.toHaveBeenCalled();
  });
});
