import { describe, expect, it } from "vitest";
import { parsePorcelain } from "./gitStatus";

describe("parsePorcelain", () => {
  it("maps a modified file to its absolute path", () => {
    const result = parsePorcelain(" M src/index.ts\n", "/repo");
    expect(result.get("/repo/src/index.ts")).toBe("modified");
  });

  it("maps an untracked file", () => {
    const result = parsePorcelain("?? notes.md\n", "/repo");
    expect(result.get("/repo/notes.md")).toBe("untracked");
  });

  it("maps a staged addition", () => {
    const result = parsePorcelain("A  new-file.ts\n", "/repo");
    expect(result.get("/repo/new-file.ts")).toBe("added");
  });

  it("maps a deleted file", () => {
    const result = parsePorcelain(" D old-file.ts\n", "/repo");
    expect(result.get("/repo/old-file.ts")).toBe("deleted");
  });

  it("uses the destination path for a rename", () => {
    const result = parsePorcelain("R  old.ts -> new.ts\n", "/repo");
    expect(result.get("/repo/new.ts")).toBe("modified");
    expect(result.has("/repo/old.ts")).toBe(false);
  });

  it("propagates a status up to ancestor directories", () => {
    const result = parsePorcelain(" M src/nested/deep/file.ts\n", "/repo");
    expect(result.get("/repo/src/nested/deep")).toBe("modified");
    expect(result.get("/repo/src/nested")).toBe("modified");
    expect(result.get("/repo/src")).toBe("modified");
  });

  it("returns an empty map for empty output", () => {
    expect(parsePorcelain("", "/repo").size).toBe(0);
  });
});
