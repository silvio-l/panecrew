import type { Project, TreeNode } from "../types/project";

/** Es gibt keine echte Platte hinter einem Demo-Projekt (Ticket 01: der
 * Harness braucht weder echte Projekt-Ordner noch eine `session.json`) —
 * der Pfad ist reine Identität für Grid/Explorer, nie ein Dateisystem-Zugriff. */
export function mockProjectPath(projectName: string): string {
  return `/demo/${projectName}`;
}

const MOCK_TREE: TreeNode[] = [
  {
    name: "src",
    isDirectory: true,
    children: [
      { name: "main.ts", isDirectory: false, kind: "ts" },
      { name: "App.tsx", isDirectory: false, kind: "tsx" },
    ],
  },
  { name: "README.md", isDirectory: false, kind: "md" },
  { name: "package.json", isDirectory: false, kind: "json" },
];

/** Statisches `Project` für einen simulierten Storyboard-Projektnamen — feste
 * Baumstruktur, kein Ladefehler, keine Git-Deko: genug, damit `ExplorerPanel`
 * etwas Sichtbares zeigt, ohne `explorer_read_dir`/`explorer_git_status`
 * zu rufen. Bereits vollständig „geladen" (jeder Ordner trägt `children`) —
 * der Harness treibt kein Lazy-Loading, es gibt ohnehin keine echte Platte
 * dahinter. */
export function mockProject(projectName: string): Project {
  return {
    path: mockProjectPath(projectName),
    name: projectName,
    tree: MOCK_TREE,
    treeError: null,
    gitDecorations: new Map(),
  };
}
