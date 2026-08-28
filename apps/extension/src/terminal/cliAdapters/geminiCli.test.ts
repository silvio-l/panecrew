import { describe, expect, it } from "vitest";
import { GEMINI_CLI_NOTIFY_COMMAND, computePatchedConfig } from "./geminiCli";

interface ParsedSettings {
  hooks: {
    Notification: { matcher?: string; hooks: { type: string; command: string }[] }[];
  };
}

function parse(text: string): ParsedSettings {
  return JSON.parse(text) as ParsedSettings;
}

describe("geminiCli computePatchedConfig", () => {
  it("creates settings.json from scratch when the file is missing", () => {
    const result = computePatchedConfig(undefined);
    expect(result.changed).toBe(true);
    expect(parse(result.text)).toEqual({
      hooks: {
        Notification: [{ hooks: [{ type: "command", command: GEMINI_CLI_NOTIFY_COMMAND }] }],
      },
    });
  });

  it("preserves an unrelated existing Notification hook", () => {
    const before = JSON.stringify({
      hooks: { Notification: [{ matcher: "ToolPermission", hooks: [{ type: "command", command: "my-script.sh" }] }] },
    });
    const result = computePatchedConfig(before);
    const after = parse(result.text);
    expect(after.hooks.Notification).toEqual([
      { matcher: "ToolPermission", hooks: [{ type: "command", command: "my-script.sh" }] },
      { hooks: [{ type: "command", command: GEMINI_CLI_NOTIFY_COMMAND }] },
    ]);
  });

  it("is a no-op when PaneCrew's own hook is already present", () => {
    const first = computePatchedConfig(undefined);
    const second = computePatchedConfig(first.text);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });

  it("throws a clear error for malformed JSON instead of silently no-opping", () => {
    expect(() => computePatchedConfig("{{{")).toThrow(/not valid JSON/);
  });
});
