// Einzige Stelle, die einen `Project` aus einem Pfad baut — `useProjects.ts`
// ist der einzige Aufrufer. Aus `App.tsx` extrahiert (Ticket 03): mit dem
// Grid kann derselbe Ordner in mehreren Panes offen sein, und der Baum darf
// dafür nicht mehrfach gelesen werden — das Deduplizieren übernimmt der
// Cache, das Lesen bleibt hier gebündelt.
import { invoke } from "@tauri-apps/api/core";
import { gitDecorationsFromStatuses, type GitFileStatus } from "../types/gitStatus";
import {
  projectNameFromPath,
  treeNodesFromRawEntries,
  type Project,
  type RawDirEntry,
  type TreeNode,
} from "../types/project";

// Ein gescheiterter Baum-Read scheitert bewusst nicht den ganzen
// Projektaufbau (das Projekt öffnet trotzdem, cwd fürs PTY ist ja da) —
// `treeError` trägt den Fehler stattdessen sichtbar weiter. Baum und
// Git-Status laufen parallel: unabhängige IPC-Aufrufe, keiner blockiert den
// anderen.
export async function buildProject(path: string): Promise<Project> {
  const name = projectNameFromPath(path);
  const [tree, gitDecorations] = await Promise.all([
    readTree(path),
    readGitDecorations(path),
  ]);
  return { path, name, ...tree, gitDecorations };
}

/** Liest EINE Verzeichnisebene (`explorer_read_dir`) und bildet sie auf
 * `TreeNode[]` ab — der gemeinsame Lese-Schritt hinter dem ersten Baumaufbau
 * (Wurzel), dem Nachladen eines aufgeklappten Ordners und dem gezielten
 * Neuladen einzelner Ordner nach einem Refresh (`useProjects.ts`). Wirft bei
 * einem Lesefehler, statt ihn zu verschlucken: die drei Aufrufer behandeln
 * einen fehlgeschlagenen Lesevorgang jeweils unterschiedlich (Projektaufbau
 * scheitert nicht am Baum, ein einzelner Ordner-Nachlade-Fehler klappt nur
 * diesen Ordner wieder zu).
 */
export async function readDirEntries(absolutePath: string): Promise<TreeNode[]> {
  const raw = await invoke<RawDirEntry[]>("explorer_read_dir", {
    path: absolutePath,
  });
  return treeNodesFromRawEntries(raw);
}

async function readTree(
  path: string,
): Promise<Pick<Project, "tree" | "treeError">> {
  try {
    const tree = await readDirEntries(path);
    return { tree, treeError: null };
  } catch (error) {
    console.error("PaneCrew: Dateibaum konnte nicht gelesen werden", error);
    return { tree: [], treeError: String(error) };
  }
}

// Kein Analogon zu `treeError`: ein Projekt, das kein Git-Repo ist (oder ein
// fehlendes `git`), ist kein Fehlerzustand des Explorers — das Backend
// (`git_status.rs`) liefert dafür schon eine leere Liste statt eines Fehlers,
// hier bleibt nur der Transport-Fall (IPC selbst schlägt fehl) abzufangen.
async function readGitDecorations(path: string) {
  try {
    const statuses = await invoke<GitFileStatus[]>("explorer_git_status", {
      root: path,
    });
    return gitDecorationsFromStatuses(statuses);
  } catch (error) {
    console.error("PaneCrew: Git-Status konnte nicht gelesen werden", error);
    return gitDecorationsFromStatuses([]);
  }
}
