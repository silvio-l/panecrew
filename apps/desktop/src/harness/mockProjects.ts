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
    children: [
      { name: "main.ts", kind: "ts" },
      { name: "App.tsx", kind: "tsx" },
    ],
  },
  { name: "README.md", kind: "md" },
  { name: "package.json", kind: "json" },
];

/** Statisches `Project` für einen simulierten Storyboard-Projektnamen — feste
 * Baumstruktur, kein Ladefehler, keine Git-Deko: genug, damit `ExplorerPanel`
 * etwas Sichtbares zeigt, ohne `explorer_read_tree`/`explorer_git_status`
 * zu rufen. */
export function mockProject(projectName: string): Project {
  return {
    path: mockProjectPath(projectName),
    name: projectName,
    tree: MOCK_TREE,
    treeError: null,
    gitDecorations: new Map(),
  };
}
