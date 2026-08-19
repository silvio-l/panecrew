import { invoke } from "@tauri-apps/api/core";

// Thin IPC wrappers for the `://` System-Befehle (`snippet_fs.rs`) — same
// split as `workingDirectory.ts`'s `path_is_directory`/`list_subdirectories`:
// `usePtyTerminal.ts` only orchestrates, the actual `invoke()` call lives in
// its own small module.

/**
 * Scaffolds `.panecrew/` (and its `snippets/` subfolder) in `projectPath`,
 * writing only example files that don't already exist. Resolves the same way
 * whether anything actually needed creating or not.
 */
export function snippetInit(projectPath: string): Promise<void> {
  return invoke("snippet_init", { projectPath });
}
