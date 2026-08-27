import { describe, expect, it } from "vitest";
import { CODEX_NOTIFY_LINE, computePatchedConfig } from "./codexCli";

describe("codexCli computePatchedConfig", () => {
  it("appends the notify line when the file is missing", () => {
    const result = computePatchedConfig(undefined);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(`${CODEX_NOTIFY_LINE}\n`);
  });

  it("appends the notify line to an existing file with unrelated settings", () => {
    const before = 'model = "o1"\napproval_policy = "on-request"\n';
    const result = computePatchedConfig(before);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(`${before.trimEnd()}\n${CODEX_NOTIFY_LINE}\n`);
  });

  it("replaces an unrelated existing notify setting rather than duplicating it", () => {
    const before = 'model = "o1"\nnotify = ["python3", "/Users/me/.codex/notify.py"]\n';
    const result = computePatchedConfig(before);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(`model = "o1"\n${CODEX_NOTIFY_LINE}\n`);
  });

  it("is a no-op when PaneCrew's own notify entry is already present", () => {
    const first = computePatchedConfig(undefined);
    const second = computePatchedConfig(first.text);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });

  it("is idempotent: patching twice behaves the same as patching once", () => {
    const before = 'model = "o1"\nnotify = ["python3", "/Users/me/.codex/notify.py"]\n';
    const once = computePatchedConfig(before);
    const twice = computePatchedConfig(once.text);
    expect(twice.text).toBe(once.text);
  });

  it("replaces a multi-line notify array value", () => {
    const before = 'model = "o1"\nnotify = [\n  "python3",\n  "/Users/me/.codex/notify.py"\n]\n';
    const result = computePatchedConfig(before);
    expect(result.text).toBe(`model = "o1"\n${CODEX_NOTIFY_LINE}\n`);
  });

  it("throws a clear error when an existing notify array is truncated (malformed)", () => {
    const before = 'model = "o1"\nnotify = [\n  "python3",\n';
    expect(() => computePatchedConfig(before)).toThrow(/can't safely parse/);
  });
});
