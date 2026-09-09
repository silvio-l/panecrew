// Most-recently-opened project paths, stored in `ExtensionContext.globalState`
// (global across workspaces, unlike `session/persistence.ts`'s per-workspace
// `workspaceState`) — the whole point is to surface them in a brand-new,
// still-empty window, which by definition has no workspace of its own yet.
import type { Memento } from "../vscodeMemento";

const STORAGE_KEY = "panecrew.recentProjects";

/** How many entries the explorer's empty-state "Recent Projects" list shows
 * (user request, .scratch/recent-projects-empty-state ticket 01) — also the
 * storage cap, since nothing beyond the 5 ever gets shown anyway. */
export const MAX_RECENT_PROJECTS = 5;

export interface RecentProject {
  path: string;
  lastOpenedAt: number;
}

export function loadRecentProjects(memento: Memento): RecentProject[] {
  return memento.get<RecentProject[]>(STORAGE_KEY) ?? [];
}

/** Records `path` as just opened — moves it to the front if already present
 * (refreshing `lastOpenedAt`) rather than duplicating it, and evicts the
 * oldest entry once the list would exceed `MAX_RECENT_PROJECTS`. Called from
 * the one real "user opened a project" choke point (`assignFolderToGrid` in
 * extension.ts), never from session-restore's backfill — a folder VS Code
 * just happened to still have open isn't the same as the user deliberately
 * opening it. */
export async function recordRecentProject(
  memento: Memento,
  path: string,
  now: () => number = Date.now,
): Promise<void> {
  const rest = loadRecentProjects(memento).filter((p) => p.path !== path);
  const next = [{ path, lastOpenedAt: now() }, ...rest].slice(0, MAX_RECENT_PROJECTS);
  await memento.update(STORAGE_KEY, next);
}

/**
 * Drops any entry `exists` reports as gone (e.g. a folder deleted or moved
 * since it was last opened) — self-healing storage rather than a list that
 * only ever grows stale, so a click never lands on a folder that's no longer
 * there. No-op write (returns the same list, skips `memento.update`) when
 * every entry still exists, matching `treeDataProvider.ts`'s
 * `setRootDescription` convention of not writing/refreshing when nothing
 * actually changed.
 */
export async function pruneMissingRecentProjects(
  memento: Memento,
  exists: (path: string) => Promise<boolean>,
): Promise<RecentProject[]> {
  const current = loadRecentProjects(memento);
  const checked = await Promise.all(
    current.map(async (project) => ({ project, exists: await exists(project.path) })),
  );
  const kept = checked.filter((c) => c.exists).map((c) => c.project);
  if (kept.length !== current.length) await memento.update(STORAGE_KEY, kept);
  return kept;
}
