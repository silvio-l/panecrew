import { describe, expect, it } from "vitest";
import { OPENCODE_PLUGIN_FILE, computePatchedConfig } from "./openCode";

describe("openCode computePatchedConfig", () => {
  it("creates the dedicated plugin file when it's missing", () => {
    const result = computePatchedConfig(undefined);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(OPENCODE_PLUGIN_FILE);
  });

  it("overwrites unrelated existing content at PaneCrew's own file path", () => {
    const before = "export const SomeOtherPlugin = async () => ({});\n";
    const result = computePatchedConfig(before);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(OPENCODE_PLUGIN_FILE);
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

  it("uses hex escapes, not octal, since octal escapes are invalid in a template literal", () => {
    expect(OPENCODE_PLUGIN_FILE).not.toMatch(/\\033|\\007/);
    expect(OPENCODE_PLUGIN_FILE).toContain("\\x1b");
    expect(OPENCODE_PLUGIN_FILE).toContain("\\x07");
  });

  it("wires both session.idle and permission.asked", () => {
    expect(OPENCODE_PLUGIN_FILE).toContain('"session.idle"');
    expect(OPENCODE_PLUGIN_FILE).toContain('"permission.asked"');
  });
});
