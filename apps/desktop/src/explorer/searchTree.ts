import { invoke } from "@tauri-apps/api/core";
import { fileKindFromName, type ContentMatch, type TreeNode } from "../types/project";

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

/** Rohform von `explorer_search_contents` — dieselbe Baumform wie
 * `RawSearchNode`, plus `matches` an jedem Datei-Blatt (nie an einem Ordner,
 * s. `ContentSearchNode` in `explorer_fs.rs`). */
interface RawContentMatch {
  line: number;
  preview: string;
}

interface RawContentSearchNode {
  name: string;
  is_dir: boolean;
  children?: RawContentSearchNode[];
  matches?: RawContentMatch[];
}

interface RawContentSearchResult {
  nodes: RawContentSearchNode[];
  truncated: boolean;
}

export interface SearchTree {
  nodes: TreeNode[];
  /** Der Voll-Baum-Walk hat mehr Treffer gefunden, als er zurückgibt (Rusts
   * `MAX_SEARCH_MATCHES`) — anders als der frühere `MAX_ENTRIES`-Bug
   * (unsichtbar verworfene GESCHWISTER) ist das hier eine offen kommunizierte
   * Kappung NUR der Trefferliste, keine still verworfenen unbeteiligten
   * Ordner. Wahr, sobald EINE der beiden Teilsuchen (Name oder Inhalt)
   * gekappt hat. */
  truncated: boolean;
}

/** Unterhalb dieser Zeichenzahl bleibt die Inhaltssuche aus — bei 1-2
 * Zeichen läse sie praktisch jede Datei unter der 2-MB-Grenze im ganzen Baum
 * (`explorer_fs.rs`s `MAX_SEARCHABLE_FILE_BYTES`) mit, während die
 * Namenssuche bei derselben Länge nahezu kostenlos bleibt (sie vergleicht nur
 * Dateinamen, nie Dateiinhalte). Ohne diese Schranke würde jeder Tastendruck
 * beim Anfangen einer Suche einen vollen Baum-Read auslösen, den die nächste
 * Anfrage sofort verwirft. */
const CONTENT_SEARCH_MIN_QUERY_LENGTH = 3;

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

function treeNodesFromContentSearch(nodes: readonly RawContentSearchNode[]): TreeNode[] {
  return nodes.map((node) =>
    node.is_dir
      ? {
          name: node.name,
          isDirectory: true,
          children: treeNodesFromContentSearch(node.children ?? []),
        }
      : {
          name: node.name,
          isDirectory: false,
          kind: fileKindFromName(node.name),
          matches: (node.matches ?? []).map(
            (match): ContentMatch => ({ line: match.line, preview: match.preview }),
          ),
        },
  );
}

/** Dieselbe Geschwister-Ordnung wie das Backend (`explorer_fs.rs`s
 * `read_dir_entries`: Ordner vor Dateien, beide Gruppen case-insensitiv
 * alphabetisch) — nötig, weil `mergeSearchNodeLists` unten zwei bereits so
 * sortierte Listen über eine `Map` zusammenführt, was ihre Reihenfolge nicht
 * von selbst erhält. */
function compareTreeNodes(a: TreeNode, b: TreeNode): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Führt zwei unabhängig vom Backend beschnittene Suchbäume (Namens- und
 * Inhaltstreffer) zu einem einzigen zusammen, damit der Explorer EIN
 * Suchfeld für beides bleibt statt zwei getrennter Modi. Ein Ordner, der in
 * beiden vorkommt, wird rekursiv vereinigt; eine Datei, die in beiden
 * vorkommt (Name UND Inhalt treffen zu), behält ihre `matches` aus der
 * Inhaltssuche — die Namenssuche liefert dafür nie welche. */
function mergeSearchNodeLists(a: readonly TreeNode[], b: readonly TreeNode[]): TreeNode[] {
  const byName = new Map<string, TreeNode>();
  for (const node of a) byName.set(node.name, node);
  for (const node of b) {
    const existing = byName.get(node.name);
    if (existing === undefined) {
      byName.set(node.name, node);
      continue;
    }
    byName.set(
      node.name,
      existing.isDirectory && node.isDirectory
        ? {
            ...existing,
            children: mergeSearchNodeLists(existing.children ?? [], node.children ?? []),
          }
        : { ...existing, matches: node.matches ?? existing.matches },
    );
  }
  return [...byName.values()].sort(compareTreeNodes);
}

/** Volltextsuche über den ganzen Projektbaum, unabhängig vom
 * Lazy-Loading-Stand des Panels — findet auch einen Treffer in einem Ordner,
 * den der Nutzer nie aufgeklappt hat. Ein Suchfeld deckt sowohl Datei- als
 * auch Inhaltstreffer ab (Ticket 26): `explorer_search_names` und
 * `explorer_search_contents` (`explorer_fs.rs`) laufen parallel, ihre
 * beschnittenen Bäume werden zu einem gemeinsamen Ergebnis vereinigt. Ersetzt
 * das frühere rein clientseitige `filterTree` (`types/treeFilter.ts`), das
 * nur den bereits geladenen Ausschnitt durchsuchen konnte. */
export async function searchProjectTree(root: string, query: string): Promise<SearchTree> {
  const nameSearch = invoke<RawSearchResult>("explorer_search_names", { root, query });
  const contentSearch =
    query.length >= CONTENT_SEARCH_MIN_QUERY_LENGTH
      ? invoke<RawContentSearchResult>("explorer_search_contents", { root, query })
      : Promise.resolve<RawContentSearchResult>({ nodes: [], truncated: false });

  const [nameResult, contentResult] = await Promise.all([nameSearch, contentSearch]);
  return {
    nodes: mergeSearchNodeLists(
      treeNodesFromSearch(nameResult.nodes),
      treeNodesFromContentSearch(contentResult.nodes),
    ),
    truncated: nameResult.truncated || contentResult.truncated,
  };
}
