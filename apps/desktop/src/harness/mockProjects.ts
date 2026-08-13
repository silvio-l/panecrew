import type { Project, TreeNode } from "../types/project";

/** Es gibt keine echte Platte hinter einem Demo-Projekt (Ticket 01: der
 * Harness braucht weder echte Projekt-Ordner noch eine `session.json`) —
 * der Pfad ist reine Identität für Grid/Explorer, nie ein Dateisystem-Zugriff. */
export function mockProjectPath(projectName: string): string {
  return `/demo/${projectName}`;
}

// Jeder im Storyboard verwendete Projektname bekommt seinen eigenen, an ein
// echtes Repo angelehnten Baum (Ticket: Aufnahme soll „wie ein echtes
// Projekt" wirken, nicht wie derselbe generische 4-Knoten-Stub für jede
// Pane) — reine Deko, keine dieser Dateien existiert wirklich, s.
// `mockProjectPath` oben.
const PROJECT_TREES: Record<string, TreeNode[]> = {
  panecrew: [
    {
      name: "apps",
      isDirectory: true,
      children: [
        {
          name: "desktop",
          isDirectory: true,
          children: [
            {
              name: "src",
              isDirectory: true,
              children: [
                {
                  name: "components",
                  isDirectory: true,
                  children: [
                    { name: "PaneGrid.tsx", isDirectory: false, kind: "tsx" },
                    { name: "TitleBar.tsx", isDirectory: false, kind: "tsx" },
                    { name: "ExplorerPanel.tsx", isDirectory: false, kind: "tsx" },
                  ],
                },
                {
                  name: "grid",
                  isDirectory: true,
                  children: [
                    { name: "gridState.ts", isDirectory: false, kind: "ts" },
                    { name: "useGrid.ts", isDirectory: false, kind: "ts" },
                  ],
                },
                { name: "App.tsx", isDirectory: false, kind: "tsx" },
                { name: "main.tsx", isDirectory: false, kind: "tsx" },
              ],
            },
            {
              name: "src-tauri",
              isDirectory: true,
              children: [
                {
                  name: "src",
                  isDirectory: true,
                  children: [
                    { name: "main.rs", isDirectory: false, kind: "rs" },
                    { name: "pty.rs", isDirectory: false, kind: "rs" },
                  ],
                },
                { name: "Cargo.toml", isDirectory: false, kind: "toml" },
                { name: "tauri.conf.json", isDirectory: false, kind: "json" },
              ],
            },
            { name: "package.json", isDirectory: false, kind: "json" },
          ],
        },
      ],
    },
    { name: "README.md", isDirectory: false, kind: "md" },
    { name: "LICENSE", isDirectory: false, kind: "file" },
    { name: ".gitignore", isDirectory: false, kind: "git" },
  ],
  website: [
    {
      name: "src",
      isDirectory: true,
      children: [
        {
          name: "pages",
          isDirectory: true,
          children: [
            { name: "index.astro", isDirectory: false, kind: "html" },
            {
              name: "guides",
              isDirectory: true,
              children: [
                { name: "multiple-cli-agent-sessions.astro", isDirectory: false, kind: "html" },
              ],
            },
          ],
        },
        {
          name: "layouts",
          isDirectory: true,
          children: [{ name: "GuideLayout.astro", isDirectory: false, kind: "html" }],
        },
      ],
    },
    {
      name: "public",
      isDirectory: true,
      children: [
        { name: "favicon.svg", isDirectory: false, kind: "file" },
        { name: "og-image.png", isDirectory: false, kind: "file" },
      ],
    },
    { name: "astro.config.mjs", isDirectory: false, kind: "js" },
    { name: "package.json", isDirectory: false, kind: "json" },
    { name: "README.md", isDirectory: false, kind: "md" },
  ],
};

const FALLBACK_TREE: TreeNode[] = [
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
 * dahinter. Unbekannte Projektnamen (z. B. in Tests) fallen auf den
 * generischen Baum zurück. */
export function mockProject(projectName: string): Project {
  return {
    path: mockProjectPath(projectName),
    name: projectName,
    tree: PROJECT_TREES[projectName] ?? FALLBACK_TREE,
    treeError: null,
    gitDecorations: new Map(),
  };
}
