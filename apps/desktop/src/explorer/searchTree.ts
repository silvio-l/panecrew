import { invoke } from "@tauri-apps/api/core";
import { fileKindFromName, type TreeNode } from "../types/project";

/** Die von `explorer_search_names` (Rust) gelieferte Rohform — ein bereits
 * auf Treffer und deren Vorfahren beschnittener Baum, siehe dessen
 * Dokumentation in `explorer_fs.rs`. */
interface RawSearchNode {
  name: string;
  is_dir: boolean;
  children?: RawSearchNode[];
}

interface RawSearchResult {
  nodes: RawSearchNode[];
  truncated: boolean;
}

export interface SearchTree {
  nodes: TreeNode[];
  /** Der Voll-Baum-Walk hat mehr Treffer gefunden, als er zurückgibt (Rusts
   * `MAX_SEARCH_MATCHES`) — anders als der frühere `MAX_ENTRIES`-Bug
   * (unsichtbar verworfene GESCHWISTER) ist das hier eine offen kommunizierte
   * Kappung NUR der Trefferliste, keine still verworfenen unbeteiligten
   * Ordner. */
  truncated: boolean;
}

function treeNodesFromSearch(nodes: readonly RawSearchNode[]): TreeNode[] {
  return nodes.map((node) =>
    node.is_dir
      ? {
          name: node.name,
          isDirectory: true,
          // Immer als „geladen" markiert (auch `[]`), nie `undefined`: sonst
          // hielte `flattenTree` einen Suchtreffer-Ordner für einen
          // unbeladenen Lazy-Load-Kandidaten und versuchte, ihn nachzuladen —
          // dieser Baum kommt komplett aus einem einzigen Backend-Walk.
          children: treeNodesFromSearch(node.children ?? []),
        }
      : { name: node.name, isDirectory: false, kind: fileKindFromName(node.name) },
  );
}

/** Volltextsuche über den ganzen Projektbaum, unabhängig vom
 * Lazy-Loading-Stand des Panels (`explorer_search_names`, `explorer_fs.rs`)
 * — findet auch einen Treffer in einem Ordner, den der Nutzer nie
 * aufgeklappt hat. Ersetzt das frühere rein clientseitige `filterTree`
 * (`types/treeFilter.ts`), das nur den bereits geladenen Ausschnitt
 * durchsuchen konnte. */
export async function searchProjectTree(root: string, query: string): Promise<SearchTree> {
  const result = await invoke<RawSearchResult>("explorer_search_names", { root, query });
  return { nodes: treeNodesFromSearch(result.nodes), truncated: result.truncated };
}
