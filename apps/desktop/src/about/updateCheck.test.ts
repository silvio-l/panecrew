import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, compareVersions } from "./updateCheck";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Partial<Response> & { ok: boolean }) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response as Response)));
}

describe("compareVersions", () => {
  it("orders segments numerically, not lexically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
  });

  it("ignores a leading v and a pre-release suffix", () => {
    expect(compareVersions("v1.2.3", "1.2.3-rc.1")).toBe(0);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0")).toBe(1);
  });
});

describe("checkForUpdate", () => {
  it("reports a newer release with its own URL", async () => {
    stubFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          tag_name: "v0.2.0",
          html_url: "https://example.test/release",
        }),
    });

    await expect(checkForUpdate("0.1.0")).resolves.toEqual({
      status: "available",
      version: "0.2.0",
      url: "https://example.test/release",
    });
  });

  it("reports the running version as current when the tag is not newer", async () => {
    stubFetch({
      ok: true,
      json: () => Promise.resolve({ tag_name: "v0.1.0" }),
    });

    await expect(checkForUpdate("0.1.0")).resolves.toEqual({
      status: "current",
    });
  });

  // Der Regelfall, solange das Repository privat ist: GitHub antwortet mit 404.
  it("fails honestly instead of claiming to be up to date", async () => {
    stubFetch({ ok: false });

    await expect(checkForUpdate("0.1.0")).resolves.toEqual({ status: "failed" });
  });

  it("fails honestly when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    await expect(checkForUpdate("0.1.0")).resolves.toEqual({ status: "failed" });
  });
});
