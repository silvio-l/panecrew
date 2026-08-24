import { invoke } from "@tauri-apps/api/core";
import type { SnippetCandidate } from "./snippetTrigger";

// Thin IPC wrappers for the `://` System-Befehle and real snippets
// (`snippet_fs.rs`) — same split as `workingDirectory.ts`'s
// `path_is_directory`/`list_subdirectories`: `usePtyTerminal.ts` only
// orchestrates, the actual `invoke()` call lives in its own small module.

/**
 * Scaffolds `.panecrew/` (and its `snippets/` subfolder) in `projectPath`,
 * writing only example files that don't already exist. Resolves the same way
 * whether anything actually needed creating or not.
 */
export function snippetInit(projectPath: string): Promise<void> {
  return invoke("snippet_init", { projectPath });
}

interface SnippetDto {
  trigger: string;
  description: string;
  body: string;
}

/**
 * Reads and merges `{projectPath}/.panecrew/snippets/` and the user's own
 * `snippets/` directory (project wins on a trigger-name collision, a
 * reserved System-Befehl name is excluded) — the backend only ever returns
 * real snippets, `kind: "snippet"` is added here rather than sent over IPC
 * for that reason.
 */
export async function snippetList(projectPath: string): Promise<SnippetCandidate[]> {
  const snippets = await invoke<SnippetDto[]>("snippet_list", { projectPath });
  return snippets.map((snippet) => ({ ...snippet, kind: "snippet" as const }));
}
