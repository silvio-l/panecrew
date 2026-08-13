// Deko-Logik für den Explorer: welche Baum-Pfade gelten als geändert, und mit
// welchem Status. Reine Funktionen — die IPC-Beschaffung (`explorer_git_status`
// in `git_status.rs`) lebt in `App.tsx`, genau wie bei `treeNodesFromRaw` und
// `explorer_read_tree` in `project.ts`.

export type GitChangeStatus = "modified" | "untracked";

/** Die von `explorer_git_status` (Rust) gelieferte Rohform: ein Eintrag pro
 * geänderter Datei, Pfad relativ zum Projekt-Root, "/"-getrennt. */
export interface GitFileStatus {
  path: string;
  status: GitChangeStatus;
}

/** Deko pro Baum-Pfad — Dateien tragen ihren eigenen Status, Ordner den
 * bedeutendsten Status irgendeines Nachfahren ("modified" schlägt
 * "untracked", dieselbe Rangfolge wie in der Aggregation des Referenz-Editors). */
export type GitDecorations = ReadonlyMap<string, GitChangeStatus>;

export function gitDecorationsFromStatuses(
  statuses: readonly GitFileStatus[],
): GitDecorations {
  const decorations = new Map<string, GitChangeStatus>();

  for (const { path, status } of statuses) {
    upgrade(decorations, path, status);
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      upgrade(decorations, segments.slice(0, depth).join("/"), status);
    }
  }

  return decorations;
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
