import { describe, expect, it } from "vitest";
import { mockProject, mockProjectPath } from "./mockProjects";

describe("mockProjectPath", () => {
  it("leitet einen stabilen simulierten Pfad aus dem Projektnamen ab", () => {
    expect(mockProjectPath("panecrew")).toBe("/demo/panecrew");
  });
});

describe("mockProject", () => {
  it("baut ein Project mit passendem Pfad/Namen und ohne Ladefehler", () => {
    const project = mockProject("panecrew");
    expect(project.path).toBe("/demo/panecrew");
    expect(project.name).toBe("panecrew");
    expect(project.treeError).toBeNull();
    expect(project.gitDecorations.size).toBe(0);
    expect(project.tree.length).toBeGreaterThan(0);
  });
});
