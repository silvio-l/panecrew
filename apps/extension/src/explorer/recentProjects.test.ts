import { describe, expect, it } from "vitest";
import { createFakeMemento } from "../testMemento";
import {
  loadRecentProjects,
  MAX_RECENT_PROJECTS,
  pruneMissingRecentProjects,
  recordRecentProject,
} from "./recentProjects";

describe("recentProjects", () => {
  it("starts empty", () => {
    expect(loadRecentProjects(createFakeMemento())).toEqual([]);
  });

  it("records a newly opened project", async () => {
    const memento = createFakeMemento();
    await recordRecentProject(memento, "/repo/a", () => 1000);
    expect(loadRecentProjects(memento)).toEqual([{ path: "/repo/a", lastOpenedAt: 1000 }]);
  });

  it("puts the most recently opened project first", async () => {
    const memento = createFakeMemento();
    await recordRecentProject(memento, "/repo/a", () => 1000);
    await recordRecentProject(memento, "/repo/b", () => 2000);
    expect(loadRecentProjects(memento).map((p) => p.path)).toEqual(["/repo/b", "/repo/a"]);
  });

  it("re-opening an already-known project moves it to the front instead of duplicating it", async () => {
    const memento = createFakeMemento();
    await recordRecentProject(memento, "/repo/a", () => 1000);
    await recordRecentProject(memento, "/repo/b", () => 2000);
    await recordRecentProject(memento, "/repo/a", () => 3000);
    expect(loadRecentProjects(memento)).toEqual([
      { path: "/repo/a", lastOpenedAt: 3000 },
      { path: "/repo/b", lastOpenedAt: 2000 },
    ]);
  });

  it(`keeps only the ${MAX_RECENT_PROJECTS} most recently opened projects`, async () => {
    const memento = createFakeMemento();
    for (let i = 0; i < MAX_RECENT_PROJECTS + 2; i++) {
      await recordRecentProject(memento, `/repo/${i}`, () => i);
    }
    const paths = loadRecentProjects(memento).map((p) => p.path);
    expect(paths).toHaveLength(MAX_RECENT_PROJECTS);
    expect(paths).toEqual(["/repo/6", "/repo/5", "/repo/4", "/repo/3", "/repo/2"]);
  });

  describe("pruneMissingRecentProjects", () => {
    it("drops entries the exists check reports as gone", async () => {
      const memento = createFakeMemento();
      await recordRecentProject(memento, "/repo/a", () => 1000);
      await recordRecentProject(memento, "/repo/b", () => 2000);

      const kept = await pruneMissingRecentProjects(memento, (path) => Promise.resolve(path !== "/repo/a"));

      expect(kept.map((p) => p.path)).toEqual(["/repo/b"]);
      expect(loadRecentProjects(memento).map((p) => p.path)).toEqual(["/repo/b"]);
    });

    it("does not write when every entry still exists", async () => {
      const memento = createFakeMemento();
      await recordRecentProject(memento, "/repo/a", () => 1000);
      const before = loadRecentProjects(memento);

      const kept = await pruneMissingRecentProjects(memento, () => Promise.resolve(true));

      expect(kept).toEqual(before);
      expect(loadRecentProjects(memento)).toEqual(before);
    });
  });
});
