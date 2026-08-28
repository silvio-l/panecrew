import { describe, expect, it } from "vitest";
import { COPILOT_CLI_HOOKS_CONFIG, computePatchedConfig } from "./copilotCli";

describe("copilotCli computePatchedConfig", () => {
  it("creates the dedicated hooks file when it's missing", () => {
    const result = computePatchedConfig(undefined);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(COPILOT_CLI_HOOKS_CONFIG);
  });

  it("overwrites unrelated existing content at PaneCrew's own file path", () => {
    const before = '{\n  "version": 1,\n  "hooks": { "sessionStart": [] }\n}\n';
    const result = computePatchedConfig(before);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(COPILOT_CLI_HOOKS_CONFIG);
  });

  it("is a no-op when PaneCrew's own file is already present", () => {
    const first = computePatchedConfig(undefined);
    const second = computePatchedConfig(first.text);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });

  it("is idempotent: patching twice behaves the same as patching once", () => {
    const once = computePatchedConfig("stale content");
    const twice = computePatchedConfig(once.text);
    expect(twice.text).toBe(once.text);
  });

  it("wires both the notification and agentStop hooks", () => {
    const parsed = JSON.parse(COPILOT_CLI_HOOKS_CONFIG) as { hooks: Record<string, unknown> };
    expect(Object.keys(parsed.hooks)).toEqual(["notification", "agentStop"]);
  });
});
