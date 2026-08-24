// Echte Domain-Typen des Explorers: ein Projekt IST ein Ordner, den der
// Nutzer im Picker gewählt hat. `path` ist zugleich Identität und
// PTY-Arbeitsverzeichnis. Der Dateibaum kommt per `explorer_read_dir`
// (`explorer_fs.rs`) real von der Platte — eine Ebene pro Aufruf, siehe
// `TreeNode` unten.

import type { GitDecorations, GitRepoSummary } from "./gitStatus";

export type FileKind =
  | "ts"
  | "tsx"
  | "js"
  | "json"
  | "rs"
  | "toml"
  | "md"
  | "css"
  | "html"
  | "sh"
  | "yaml"
  | "git"
  | "lock"
  | "file";

/** Eine einzelne Zeile eines Volltext-Treffers (`explorer_search_contents`,
 * `explorer_fs.rs`) — `line` ist 1-indexed wie dort. */
export interface ContentMatch {
  line: number;
  preview: string;
}

export interface TreeNode {
  name: string;
  kind?: FileKind;
  /** Ob dieser Knoten ein Ordner ist — eigenständig von `children`, weil
   * Lazy-Loading (`explorer_read_dir`) einen Ordner zunächst NUR als solchen
   * kennt, ohne seine Kinder gelesen zu haben. Vorher (bei der eager
   * Rekursion von `explorer_read_tree`) fiel diese Unterscheidung mit
   * `children !== undefined` zusammen — das war der strukturelle Kern des
   * Bugs, der einen früh-alphabetischen Ordner mit sehr vielen Einträgen alle
   * nachfolgenden Geschwister aus dem Budget verdrängen ließ (whispaste,
   * 2026-08-13): der Fix macht das Laden pro Ordner unabhängig von jedem
   * anderen, und dafür muss „ist Ordner" von „Kinder geladen" getrennt sein. */
  isDirectory: boolean;
  /** `undefined` heißt bei einem Ordner „noch nicht geladen" — bei einer
   * Datei ist es immer `undefined`. Ein geladener, leerer Ordner trägt `[]`,
   * unterscheidbar von „noch nicht geladen". */
  children?: TreeNode[];
  /** Nur bei einem Suchtreffer-Baum gesetzt (`searchTree.ts`s
   * `searchProjectTree`) — die Zeilentreffer einer Inhaltssuche in genau
   * dieser Datei. Im normalen Projektbaum immer `undefined`, nicht `[]`: der
   * Explorer liest Dateiinhalte sonst nie ein, „nicht durchsucht" und
   * „durchsucht, keine Treffer" dürfen nicht gleich aussehen. */
  matches?: readonly ContentMatch[];
}

export interface Project {
  /** Absoluter Ordnerpfad — Identität der Pane und cwd des PTY-Prozesses. */
  path: string;
  /** Letztes Pfadsegment, der im Chrome angezeigte Projektname. */
  name: string;
  tree: TreeNode[];
  /** Fehlertext, falls `explorer_read_tree` fehlschlug (z. B. Rechte) — vom
   * bloß leeren Baum unterscheidbar, damit ein Lesefehler nie wie ein leeres
   * Projekt aussieht. */
  treeError: string | null;
  /** Änderungs-Deko aus `explorer_git_status` (`git_status.rs`) — leer, wenn
   * das Projekt kein Git-Repo ist oder `git` nicht gefunden wurde; das ist
   * bewusst kein Fehlerzustand, siehe `git_status.rs`. */
  gitDecorations: GitDecorations;
  /** Branch/Dirty/Ahead-Behind/Worktree-Zusammenfassung aus demselben
   * `explorer_git_status`-Aufruf (Ticket 02/03) — `null`, wenn das Projekt
   * kein Git-Repo ist; genau wie `gitDecorations` bewusst kein
   * Fehlerzustand. */
  gitRepo: GitRepoSummary | null;
}

/** Letztes Segment eines absoluten Pfads (POSIX wie Windows). */
export function projectNameFromPath(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? path;
}

/** Die von `explorer_read_dir` (Rust) gelieferte Rohform EINER Ebene: nur
 * `name` und `is_dir` — keine Dateityp-Information, die ist reine Optik und
 * bleibt deshalb hier im Frontend, und keine Kinder, die sind der ganze Sinn
 * des Lazy-Loadings. */
export interface RawDirEntry {
  name: string;
  is_dir: boolean;
}

const EXTENSION_KIND: Partial<Record<string, FileKind>> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  rs: "rs",
  toml: "toml",
  md: "md",
  css: "css",
  html: "html",
  htm: "html",
  sh: "sh",
  bash: "sh",
  // Beide Schreibweisen kommen in diesem Repo selbst vor (.github/workflows
  // führt .yml, pnpm-workspace.yaml das lange Suffix) — Seti kennt für beide
  // dasselbe Glyph.
  yml: "yaml",
  yaml: "yaml",
  lock: "lock",
};

const GIT_DOTFILES = new Set([".gitignore", ".gitattributes", ".gitmodules"]);

/** Leitet die Icon-Farbkategorie aus dem Dateinamen her — rein präsentational,
 * deshalb bewusst nicht in Rust (das liefert nur `name`/`children`). */
export function fileKindFromName(name: string): FileKind {
  if (GIT_DOTFILES.has(name)) return "git";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "file";
  const extension = name.slice(dot + 1).toLowerCase();
  return EXTENSION_KIND[extension] ?? "file";
}

/** Bildet die von `explorer_read_dir` gelieferten Roheinträge EINER Ebene auf
 * `TreeNode[]` ab. Die Sortierung kommt schon fertig aus Rust — hier wird nur
 * noch der `kind` pro Datei ergänzt. Ordner bekommen bewusst kein
 * `children`: das ist der unbeladene Ausgangszustand, den Lazy-Loading erst
 * durch einen weiteren `explorer_read_dir`-Aufruf füllt. */
export function treeNodesFromRawEntries(entries: readonly RawDirEntry[]): TreeNode[] {
  return entries.map((entry) =>
    entry.is_dir
      ? { name: entry.name, isDirectory: true }
      : { name: entry.name, isDirectory: false, kind: fileKindFromName(entry.name) },
  );
}

/** Ersetzt unveränderlich die Kinder DES Ordners an `relPath` (Tiefe 0: der
 * bloße Name, darunter `${eltern}/${name}`, dieselbe Konvention wie überall
 * im Explorer) — der Merge-Schritt eines Lazy-Loads in den gecachten Baum.
 * Findet sich `relPath` nicht (z. B. weil ein Elternordner selbst noch nicht
 * geladen ist), bleibt `nodes` unverändert: ein Aufruf, der zeitlich vor
 * seinem Elternordner ankommt, darf den Baum nicht stillschweigend verwerfen.
 */
export function withChildrenAt(
  nodes: readonly TreeNode[],
  relPath: string,
  children: TreeNode[],
): TreeNode[] {
  const separator = relPath.indexOf("/");
  const head = separator === -1 ? relPath : relPath.slice(0, separator);
  const rest = separator === -1 ? "" : relPath.slice(separator + 1);
  return nodes.map((node) => {
    if (node.name !== head) return node;
    if (rest === "") return { ...node, children };
    if (node.children === undefined) return node;
    return { ...node, children: withChildrenAt(node.children, rest, children) };
  });
}

/** Jeder Ordnerpfad, dessen Kinder bereits geladen sind — die Menge, die ein
 * Refresh nach dem Neulesen der Wurzel gezielt nachladen muss, damit
 * aufgeklappte Ordner danach nicht plötzlich wieder unbeladen dastehen (s.
 * `useProjects.ts`s `refresh`). */
export function collectLoadedFolderPaths(
  nodes: readonly TreeNode[],
  parentPath: string,
): string[] {
  return nodes.flatMap((node) => {
    if (!node.isDirectory || node.children === undefined) return [];
    const path = parentPath === "" ? node.name : `${parentPath}/${node.name}`;
    return [path, ...collectLoadedFolderPaths(node.children, path)];
  });
}
