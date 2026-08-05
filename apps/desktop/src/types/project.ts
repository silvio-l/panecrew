// Echte Domain-Typen des Explorers (kein Mock mehr): ein Projekt IST ein
// Ordner, den der Nutzer im Picker gewählt hat. `path` ist zugleich Identität
// und PTY-Arbeitsverzeichnis. Der Dateibaum wird in Ticket 04 real eingelesen;
// bis dahin liefert der Picker ihn bewusst leer statt erfunden.

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
}

/** Letztes Segment eines absoluten Pfads (POSIX wie Windows). */
export function projectNameFromPath(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? path;
}
