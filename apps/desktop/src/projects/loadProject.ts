// Einzige Stelle, die einen `Project` aus einem Pfad baut — `useProjects.ts`
// ist der einzige Aufrufer. Aus `App.tsx` extrahiert (Ticket 03): mit dem
// Grid kann derselbe Ordner in mehreren Panes offen sein, und der Baum darf
// dafür nicht mehrfach gelesen werden — das Deduplizieren übernimmt der
// Cache, das Lesen bleibt hier gebündelt.
import { invoke } from "@tauri-apps/api/core";
import { gitDecorationsFromStatuses, type GitFileStatus } from "../types/gitStatus";
import {
  projectNameFromPath,
  treeNodesFromRaw,
  type Project,
  type RawTreeNode,
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

async function readTree(
  path: string,
): Promise<Pick<Project, "tree" | "treeError">> {
  try {
    const ipcStart = performance.now();
    const raw = await invoke<RawTreeNode[]>("explorer_read_tree", {
      root: path,
    });
    const ipcMs = performance.now() - ipcStart;
    const mapStart = performance.now();
    const tree = treeNodesFromRaw(raw);
    const mapMs = performance.now() - mapStart;
    // Perf-Diagnose (2026-08-12): trennt IPC-Wartezeit (Rust) von der
    // synchronen Mapping-Zeit (JS-Hauptthread) — nur letztere kann die UI
    // blockieren, auch wenn `explorer_read_tree` selbst inzwischen async ist.
    console.debug(
      `PaneCrew: explorer_read_tree IPC ${ipcMs.toFixed(0)}ms, treeNodesFromRaw ${mapMs.toFixed(0)}ms, ${raw.length} Knoten`,
    );
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
    const ipcStart = performance.now();
    const statuses = await invoke<GitFileStatus[]>("explorer_git_status", {
      root: path,
    });
    const ipcMs = performance.now() - ipcStart;
    const mapStart = performance.now();
    const decorations = gitDecorationsFromStatuses(statuses);
    const mapMs = performance.now() - mapStart;
    console.debug(
      `PaneCrew: explorer_git_status IPC ${ipcMs.toFixed(0)}ms, gitDecorationsFromStatuses ${mapMs.toFixed(0)}ms, ${statuses.length} Einträge`,
    );
    return decorations;
  } catch (error) {
    console.error("PaneCrew: Git-Status konnte nicht gelesen werden", error);
    return gitDecorationsFromStatuses([]);
  }
}
