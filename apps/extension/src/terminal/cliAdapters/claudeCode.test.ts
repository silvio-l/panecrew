import { describe, expect, it } from "vitest";
import { CLAUDE_CODE_NOTIFY_COMMAND, CLAUDE_CODE_STOP_COMMAND, computePatchedConfig } from "./claudeCode";

interface ParsedSettings {
  someOtherSetting?: boolean;
  hooks: {
    PreToolUse?: unknown[];
    Notification: { hooks: { type: string; command: string }[] }[];
    Stop: { hooks: { type: string; command: string }[] }[];
  };
}

function parse(text: string): ParsedSettings {
  return JSON.parse(text) as ParsedSettings;
}

describe("claudeCode computePatchedConfig", () => {
  it("creates settings.json from scratch when the file is missing", () => {
    const result = computePatchedConfig(undefined);
    expect(result.changed).toBe(true);
    expect(parse(result.text)).toEqual({
      hooks: {
        Notification: [{ hooks: [{ type: "command", command: CLAUDE_CODE_NOTIFY_COMMAND }] }],
        Stop: [{ hooks: [{ type: "command", command: CLAUDE_CODE_STOP_COMMAND }] }],
      },
    });
  });

  it("treats an empty file the same as a missing one", () => {
    const result = computePatchedConfig("   \n");
    expect(result.changed).toBe(true);
    expect(parse(result.text).hooks.Notification).toHaveLength(1);
    expect(parse(result.text).hooks.Stop).toHaveLength(1);
  });

  it("preserves unrelated existing settings and hooks", () => {
    const before = JSON.stringify(
      {
        someOtherSetting: true,
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
          Notification: [{ hooks: [{ type: "command", command: "notify-send custom" }] }],
        },
      },
      null,
      2,
    );
    const result = computePatchedConfig(before);
    expect(result.changed).toBe(true);
    const after = parse(result.text);
    expect(after.someOtherSetting).toBe(true);
    expect(after.hooks.PreToolUse).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] },
    ]);
    expect(after.hooks.Notification).toEqual([
      { hooks: [{ type: "command", command: "notify-send custom" }] },
      { hooks: [{ type: "command", command: CLAUDE_CODE_NOTIFY_COMMAND }] },
    ]);
    expect(after.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: CLAUDE_CODE_STOP_COMMAND }] }]);
  });

  it("is a no-op when PaneCrew's own hooks are already present", () => {
    const first = computePatchedConfig(undefined);
    const second = computePatchedConfig(first.text);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });

  it("is idempotent: patching twice behaves the same as patching once", () => {
    const before = JSON.stringify({ hooks: { Notification: [{ hooks: [{ type: "command", command: "custom" }] }] } });
    const once = computePatchedConfig(before);
    const twice = computePatchedConfig(once.text);
    expect(twice.text).toBe(once.text);
  });

  it("throws a clear error for malformed JSON instead of silently no-opping", () => {
    expect(() => computePatchedConfig("{ not valid json")).toThrow(/not valid JSON/);
  });
});
