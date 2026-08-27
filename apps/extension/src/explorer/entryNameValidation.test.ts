import { describe, expect, it } from "vitest";
import { validateEntryName } from "./entryNameValidation";

describe("validateEntryName", () => {
  it("accepts a plain name", () => {
    expect(validateEntryName("notes.md")).toBeUndefined();
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateEntryName("  notes.md  ")).toBeUndefined();
  });

  it("rejects an empty name", () => {
    expect(validateEntryName("")).toBe("Name can't be empty.");
  });

  it("rejects a name that's only whitespace", () => {
    expect(validateEntryName("   ")).toBe("Name can't be empty.");
  });

  it("rejects the current-directory dot segment", () => {
    expect(validateEntryName(".")).toBe("That's not a valid name.");
  });

  it("rejects the parent-directory dot segment", () => {
    expect(validateEntryName("..")).toBe("That's not a valid name.");
  });

  it("rejects a forward-slash path separator", () => {
    expect(validateEntryName("nested/notes.md")).toBe("Name can't contain a path separator.");
  });

  it("rejects a backslash path separator", () => {
    expect(validateEntryName("nested\\notes.md")).toBe("Name can't contain a path separator.");
  });

  it("accepts a dotfile", () => {
    expect(validateEntryName(".gitignore")).toBeUndefined();
  });
});
