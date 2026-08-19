import { describe, expect, it } from "vitest";
import { ADAPTERS, defaultAdapterIdFromSetting, launchLineFor, resolveAdapter } from "./adapters";

describe("adapters (Ticket 35)", () => {
  it("lists the fixed, in-code CLI tools, same ids as toolIcons.tsx's TOOL_BY_ID", () => {
    expect(ADAPTERS.map((adapter) => adapter.id)).toEqual([
      "claude", // brandlint-ok: canonical adapter id, functional
      "codex", // brandlint-ok: canonical adapter id, functional
      "gemini", // brandlint-ok: canonical adapter id, functional
      "copilot", // brandlint-ok: canonical adapter id, functional
      "opencode",
    ]);
  });

  it("resolves a known adapter id to its adapter entry", () => {
    expect(resolveAdapter("claude")).toEqual({ id: "claude", command: "claude" }); // brandlint-ok: canonical adapter id, functional
  });

  it("resolves null (built-in login shell) for a null adapter id", () => {
    expect(resolveAdapter(null)).toBeNull();
  });

  it("resolves an unknown/stale adapter id back to the built-in login shell instead of throwing", () => {
    expect(resolveAdapter("some-removed-tool")).toBeNull();
  });

  it("builds a launch line that runs the adapter's command as typed input", () => {
    expect(launchLineFor({ id: "claude", command: "claude" })).toBe("claude\r"); // brandlint-ok: canonical adapter id, functional
  });

  it("reads a tool id straight off the terminal.defaultAdapter setting value", () => {
    expect(defaultAdapterIdFromSetting("codex")).toBe("codex"); // brandlint-ok: canonical adapter id, functional
  });

  it("treats the setting's built-in \"shell\" option the same as no default", () => {
    expect(defaultAdapterIdFromSetting("shell")).toBeNull();
  });

  it("treats a missing/not-yet-loaded setting value the same as no default", () => {
    expect(defaultAdapterIdFromSetting(undefined)).toBeNull();
  });

  it("treats a non-string setting value the same as no default", () => {
    expect(defaultAdapterIdFromSetting(42)).toBeNull();
  });
});
