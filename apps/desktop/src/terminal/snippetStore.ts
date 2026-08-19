import { snippetList } from "./snippetCommands";
import type { SnippetCandidate } from "./snippetTrigger";

// Shared, per-project cache of real snippets — one entry per project path,
// not one per tab. Before this, `usePtyTerminal.ts` kept its own loaded list
// in a per-effect closure: `://reload-snippets` in one tab never reached a
// second open tab of the SAME project, which had to run its own reload (or
// wait for a restart) to see a newly added snippet file. Keyed by project
// path for the same reason `loadSnippets` itself reads a fixed `cwd` rather
// than the live, `cd`-tracked directory — see usePtyTerminal.ts's comment
// on that.

interface Entry {
  snippets: readonly SnippetCandidate[];
  listeners: Set<() => void>;
  pending: Promise<void> | null;
}

const entries = new Map<string, Entry>();

function entryFor(projectPath: string): Entry {
  let entry = entries.get(projectPath);
  if (!entry) {
    entry = { snippets: [], listeners: new Set(), pending: null };
    entries.set(projectPath, entry);
  }
  return entry;
}

/** The last successfully loaded list for `projectPath` — empty before the first load resolves. */
export function snippetsFor(projectPath: string): readonly SnippetCandidate[] {
  return entries.get(projectPath)?.snippets ?? [];
}

/**
 * Re-reads `projectPath`'s snippets and notifies every tab subscribed to
 * that project, including tabs other than the caller. Concurrent calls for
 * the same project share one underlying `snippetList` read — same reasoning
 * as `shellHistory.ts`'s single pending promise, just per project instead of
 * global — so several tabs of the same project mounting at once don't each
 * trigger their own read.
 */
export function reloadSnippets(projectPath: string): Promise<void> {
  const entry = entryFor(projectPath);
  entry.pending ??= snippetList(projectPath)
    .then((loaded) => {
      entry.snippets = loaded;
      for (const listener of entry.listeners) listener();
    })
    .catch(() => {
      // Leaves the previous (or still-empty) list in place — same silent
      // fallback to System-Befehle-only as the pre-store implementation.
    })
    .finally(() => {
      entry.pending = null;
    });
  return entry.pending;
}

/** Called after every `reloadSnippets` for the same project resolves — including ones another tab triggered. */
export function subscribeSnippets(projectPath: string, listener: () => void): () => void {
  const entry = entryFor(projectPath);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}
