// Echte Domain-Typen des Explorers: ein Projekt IST ein Ordner, den der
// Nutzer im Picker gewählt hat. `path` ist zugleich Identität und
// PTY-Arbeitsverzeichnis. Der Dateibaum kommt per `explorer_read_tree`
// (`explorer_fs.rs`) real von der Platte.

import type { GitDecorations } from "./gitStatus";

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

export interface TreeNode {
  name: string;
  kind?: FileKind;
  children?: TreeNode[];
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
}

/** Letztes Segment eines absoluten Pfads (POSIX wie Windows). */
export function projectNameFromPath(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? path;
}

/** Die von `explorer_read_tree` (Rust) gelieferte Rohform: nur `name` und,
 * ausschließlich bei Verzeichnissen, `children` — keine Dateityp-Information,
 * die ist reine Optik und bleibt deshalb hier im Frontend. */
export interface RawTreeNode {
  name: string;
  children?: RawTreeNode[];
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

/** Bildet die von `explorer_read_tree` gelieferten Rohknoten auf `TreeNode[]`
 * ab. Die Sortierung kommt schon fertig aus Rust — hier wird nur noch der
 * `kind` pro Datei ergänzt, rekursiv für Unterverzeichnisse. */
export function treeNodesFromRaw(nodes: RawTreeNode[]): TreeNode[] {
  return nodes.map((node) =>
    node.children
      ? { name: node.name, children: treeNodesFromRaw(node.children) }
      : { name: node.name, kind: fileKindFromName(node.name) },
  );
}
