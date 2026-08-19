// Git-Status für den Explorer: Baum-Dekoration (welche Pfade gelten als
// geändert) plus Repo-Zusammenfassung (Branch, Dirty-Zähler, Ahead/Behind,
// Worktree-Erkennung) — beides aus einem einzigen `explorer_git_status`-Aufruf
// (`git_status.rs`, git2-Migration Ticket 01). Reine Funktionen — die IPC-
// Beschaffung lebt in `projects/loadProject.ts`, genau wie bei
// `treeNodesFromRaw` und `explorer_read_tree` in `project.ts`.

/** Die von `explorer_git_status` (Rust, `GitFileState`) gelieferten
 * Roh-Zustände — eine Datei kann mehrere gleichzeitig tragen, z. B.
 * teilweise gestaged. */
type GitFileState = "staged" | "unstaged" | "conflicted" | "untracked";

/** Rohform EINES Datei-Eintrags aus `explorer_git_status`: Pfad relativ zum
 * Projekt-Root, "/"-getrennt. */
export interface RawGitFileStatus {
  path: string;
  states: GitFileState[];
}

/** Rohform des Branch-Felds — `name` ist `null` bei detached HEAD oder wenn
 * HEAD sich gar nicht auflösen lässt; `ahead`/`behind` sind `null` (nicht
 * `0`), wenn kein Tracking-Branch konfiguriert ist. Keine Umbenennung
 * gegenüber der Rust-Seite nötig (`GitBranchStatus` in `git_status.rs`),
 * deshalb identisch mit der Domain-Form unten. */
interface RawGitBranchStatus {
  name: string | null;
  detached: boolean;
  ahead: number | null;
  behind: number | null;
}

/** Rohform des Worktree-Felds — `null`, wenn der Projekt-Root kein Git-
 * Worktree eines anderen Haupt-Repos ist. */
interface RawGitWorktreeStatus {
  main_repo_name: string;
}

/** Die von `explorer_git_status` gelieferte Gesamt-Rohform. */
export interface RawGitRepoStatus {
  files: RawGitFileStatus[];
  branch: RawGitBranchStatus | null;
  worktree: RawGitWorktreeStatus | null;
}

/** Deko pro Baum-Pfad — Dateien tragen ihren eigenen Status, Ordner den
 * bedeutendsten Status irgendeines Nachfahren ("modified" schlägt
 * "untracked", dieselbe Rangfolge wie in der Aggregation des Referenz-Editors). */
export type GitChangeStatus = "modified" | "untracked";
export type GitDecorations = ReadonlyMap<string, GitChangeStatus>;

/** Keine Feldumbenennung nötig — Alias statt eigener Mapper-Funktion, siehe
 * `RawGitBranchStatus` oben. */
type GitBranchStatus = RawGitBranchStatus;

interface GitWorktreeStatus {
  mainRepoName: string;
}

/** Zusammenfassung für `GridStatusRail` und die Explorer-Kopfzeile (Ticket
 * 02/03) — `null`, wenn der Projekt-Root gar kein Git-Repo ist; beide
 * Anzeigestellen zeigen dann nichts, statt eines leeren Platzhalters.
 * `branch` ist bei jedem erkannten Repo gesetzt (auch bei detached HEAD) —
 * Rust liefert `branch: Some(...)` für jeden Fund mit Arbeitsverzeichnis. */
export interface GitRepoSummary {
  branch: GitBranchStatus;
  /** Zahl der Dateien mit mindestens einem Staged/Unstaged/Conflicted-
   * Zustand — bewusst ohne rein Untracked-Dateien (die sind neu, nicht
   * "schmutzig" im git-Sinn). */
  dirtyCount: number;
  worktree: GitWorktreeStatus | null;
}

export function gitDecorationsFromStatuses(
  files: readonly RawGitFileStatus[],
): GitDecorations {
  const decorations = new Map<string, GitChangeStatus>();

  for (const { path, states } of files) {
    const status = decorationStatus(states);
    upgrade(decorations, path, status);
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      upgrade(decorations, segments.slice(0, depth).join("/"), status);
    }
  }

  return decorations;
}

/** Jeder Zustand außer reinem "untracked" zählt für die Baum-Farbe als
 * "modified" — Conflicted ist für die Baum-Deko kein eigener dritter Ton,
 * `GitRepoSummary.dirtyCount` zählt genauer. */
function decorationStatus(states: readonly GitFileState[]): GitChangeStatus {
  return states.some((state) => state !== "untracked")
    ? "modified"
    : "untracked";
}

/** Setzt den Status, außer der Pfad ist schon als "modified" markiert — das
 * ist der höchste Rang, den kein weiterer Fund mehr herabstufen darf. */
function upgrade(
  decorations: Map<string, GitChangeStatus>,
  path: string,
  status: GitChangeStatus,
): void {
  if (decorations.get(path) === "modified") return;
  decorations.set(path, status);
}

export function gitRepoSummaryFromRaw(
  raw: RawGitRepoStatus,
): GitRepoSummary | null {
  if (raw.branch === null) return null;
  return {
    branch: raw.branch,
    dirtyCount: raw.files.filter((file) =>
      file.states.some((state) => state !== "untracked"),
    ).length,
    worktree:
      raw.worktree === null
        ? null
        : { mainRepoName: raw.worktree.main_repo_name },
  };
}
