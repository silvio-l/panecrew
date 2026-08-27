import { describe, expect, it } from "vitest";
import { isDescendantPath } from "./pathContainment";

describe("isDescendantPath", () => {
  it("is true for the exact same path", () => {
    expect(isDescendantPath("/repo/src", "/repo/src")).toBe(true);
  });

  it("is true for a direct child", () => {
    expect(isDescendantPath("/repo/src", "/repo/src/utils")).toBe(true);
  });

  it("is true for a nested descendant", () => {
    expect(isDescendantPath("/repo/src", "/repo/src/utils/helpers.ts")).toBe(true);
  });

  it("is false for a sibling with a shared prefix", () => {
    expect(isDescendantPath("/repo/src", "/repo/src-legacy")).toBe(false);
  });

  it("is false for the parent of the candidate", () => {
    expect(isDescendantPath("/repo/src", "/repo")).toBe(false);
  });

  it("is false for an unrelated path", () => {
    expect(isDescendantPath("/repo/src", "/other/place")).toBe(false);
  });
});
