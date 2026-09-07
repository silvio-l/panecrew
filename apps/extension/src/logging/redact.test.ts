import { describe, expect, it } from "vitest";
import { redactHomeDir, redactSecrets, sanitizeForLog, sanitizeLogValue } from "./redact";

describe("sanitizeLogValue", () => {
  it("strips control characters and newlines (log-injection guard)", () => {
    expect(sanitizeLogValue("line one\nFAKE-LOG-LINE: admin logged in\r\n")).toBe(
      "line one FAKE-LOG-LINE: admin logged in",
    );
  });

  it("strips tabs and other C0 control characters", () => {
    expect(sanitizeLogValue("a\tb\x00c\x1fd")).toBe("a b c d");
  });

  it("truncates values past the max length", () => {
    const long = "a".repeat(600);
    const result = sanitizeLogValue(long);
    expect(result.endsWith("…[truncated]")).toBe(true);
    expect(result.length).toBeLessThan(long.length);
  });

  it("leaves an ordinary short message untouched", () => {
    expect(sanitizeLogValue('grid layout applied for "my-project"')).toBe('grid layout applied for "my-project"');
  });
});

describe("redactHomeDir", () => {
  it("replaces every occurrence of the home directory with ~", () => {
    expect(redactHomeDir("/Users/silvio/projects/panecrew and /Users/silvio/other", "/Users/silvio")).toBe(
      "~/projects/panecrew and ~/other",
    );
  });

  it("is a no-op when home is empty", () => {
    expect(redactHomeDir("/Users/silvio/projects", "")).toBe("/Users/silvio/projects");
  });
});

describe("redactSecrets", () => {
  it("masks a token=... assignment while keeping the key name", () => {
    expect(redactSecrets("Authorization token=abc123def456")).toBe("Authorization token=[REDACTED]");
  });

  it("masks a Bearer header", () => {
    expect(redactSecrets("sent Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 to server")).toBe(
      "sent [REDACTED] to server",
    );
  });

  it("masks an OpenAI-style secret key", () => {
    expect(redactSecrets("using key sk-abcdefghij1234567890")).toBe("using key [REDACTED]");
  });

  it("masks a GitHub personal access token", () => {
    expect(redactSecrets("ghp_1234567890abcdefghij1234567890abcdef")).toBe("[REDACTED]");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets('renamed "settings.json" to "settings.json.bak"')).toBe(
      'renamed "settings.json" to "settings.json.bak"',
    );
  });
});

describe("sanitizeForLog", () => {
  it("combines control-char stripping, home masking, and secret masking", () => {
    const result = sanitizeForLog("failed for /Users/silvio/proj\ntoken=deadbeef", "/Users/silvio");
    expect(result).toBe("failed for ~/proj token=[REDACTED]");
  });
});
