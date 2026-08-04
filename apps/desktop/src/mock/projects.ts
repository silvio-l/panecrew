// Generisches Demo-Material für den Frontend-Prototyp — wird durch echte
// PTY-Sessions und einen echten Verzeichnis-Scan ersetzt (Tickets 03/04).

export type AnsiColor =
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightCyan";

interface TermSegment {
  text: string;
  color?: AnsiColor;
}

export type TermLine = TermSegment[];

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
  id: string;
  name: string;
  selectedFile: string;
  tree: TreeNode[];
  terminal: TermLine[];
}

const prompt = (text: string): TermLine => [
  { text: "$ ", color: "brightBlack" },
  { text },
];

export const projects: Project[] = [
  {
    id: "storefront",
    name: "storefront",
    selectedFile: "src/App.tsx",
    tree: [
      {
        name: "src",
        children: [
          {
            name: "components",
            children: [
              { name: "CartBadge.tsx", kind: "tsx" },
              { name: "ProductCard.tsx", kind: "tsx" },
              { name: "index.ts", kind: "ts" },
            ],
          },
          {
            name: "hooks",
            children: [{ name: "useCart.ts", kind: "ts" }],
          },
          { name: "App.tsx", kind: "tsx" },
          { name: "main.tsx", kind: "tsx" },
          { name: "styles.css", kind: "css" },
        ],
      },
      { name: ".gitignore", kind: "git" },
      { name: "index.html", kind: "html" },
      { name: "package.json", kind: "json" },
      { name: "tsconfig.json", kind: "json" },
      { name: "README.md", kind: "md" },
    ],
    terminal: [
      prompt("pnpm dev"),
      [],
      [
        { text: "  VITE v7.0.4", color: "brightCyan" },
        { text: "  ready in " },
        { text: "342 ms", color: "brightGreen" },
      ],
      [],
      [
        { text: "  ➜  ", color: "brightGreen" },
        { text: "Local:   " },
        { text: "http://localhost:5173/", color: "brightCyan" },
      ],
      [
        { text: "  ➜  ", color: "brightGreen" },
        { text: "Network: use --host to expose", color: "brightBlack" },
      ],
      [],
      [
        { text: "12:04:31 ", color: "brightBlack" },
        { text: "[vite] ", color: "brightCyan" },
        { text: "hmr update " },
        { text: "/src/components/ProductCard.tsx", color: "brightGreen" },
      ],
    ],
  },
  {
    id: "billing-service",
    name: "billing-service",
    selectedFile: "src/routes.rs",
    tree: [
      {
        name: "src",
        children: [
          { name: "db.rs", kind: "rs" },
          { name: "main.rs", kind: "rs" },
          { name: "models.rs", kind: "rs" },
          { name: "routes.rs", kind: "rs" },
        ],
      },
      {
        name: "tests",
        children: [{ name: "invoices.rs", kind: "rs" }],
      },
      { name: ".gitignore", kind: "git" },
      { name: "Cargo.lock", kind: "lock" },
      { name: "Cargo.toml", kind: "toml" },
      { name: "README.md", kind: "md" },
    ],
    terminal: [
      prompt("cargo test"),
      [
        { text: "   Compiling", color: "brightGreen" },
        { text: " billing-service v0.4.1" },
      ],
      [
        { text: "    Finished", color: "brightGreen" },
        { text: " `test` profile [unoptimized + debuginfo] target(s) in 4.87s" },
      ],
      [
        { text: "     Running", color: "brightGreen" },
        { text: " tests/invoices.rs" },
      ],
      [],
      [{ text: "running 24 tests" }],
      [
        { text: "test invoices::totals_are_rounded ... " },
        { text: "ok", color: "brightGreen" },
      ],
      [
        { text: "test invoices::draft_is_not_billed ... " },
        { text: "ok", color: "brightGreen" },
      ],
      [],
      [
        { text: "test result: " },
        { text: "ok", color: "brightGreen" },
        { text: ". 24 passed; 0 failed; 0 ignored" },
      ],
    ],
  },
  {
    id: "docs-site",
    name: "docs-site",
    selectedFile: "content/getting-started.md",
    tree: [
      {
        name: "content",
        children: [
          { name: "configuration.md", kind: "md" },
          { name: "faq.md", kind: "md" },
          { name: "getting-started.md", kind: "md" },
        ],
      },
      {
        name: "styles",
        children: [{ name: "main.css", kind: "css" }],
      },
      { name: ".gitignore", kind: "git" },
      { name: "package.json", kind: "json" },
      { name: "README.md", kind: "md" },
    ],
    terminal: [
      prompt("pnpm build"),
      [],
      [
        { text: "info ", color: "brightCyan" },
        { text: "building client + server bundles..." },
      ],
      [
        { text: "info ", color: "brightCyan" },
        { text: "rendering pages..." },
      ],
      [
        { text: "✓", color: "brightGreen" },
        { text: " 48 pages generated in 3.2s" },
      ],
      [
        { text: "✓", color: "brightGreen" },
        { text: " sitemap written to dist/sitemap.xml" },
      ],
      [],
      [
        { text: "output: ", color: "brightBlack" },
        { text: "dist/ " },
        { text: "(1.4 MB)", color: "brightBlack" },
      ],
    ],
  },
  {
    id: "infra-scripts",
    name: "infra-scripts",
    selectedFile: "scripts/rollout.sh",
    tree: [
      {
        name: "config",
        children: [
          { name: "production.json", kind: "json" },
          { name: "staging.json", kind: "json" },
        ],
      },
      {
        name: "scripts",
        children: [
          { name: "cleanup.sh", kind: "sh" },
          { name: "rollout.sh", kind: "sh" },
        ],
      },
      { name: ".gitignore", kind: "git" },
      { name: "Makefile", kind: "file" },
      { name: "README.md", kind: "md" },
    ],
    terminal: [
      prompt("git status"),
      [{ text: "On branch main" }],
      [{ text: "Changes not staged for commit:" }],
      [
        { text: "  (use \"git add ...\" to update what will be committed)", color: "brightBlack" },
      ],
      [
        { text: "        modified:   " },
        { text: "scripts/rollout.sh", color: "red" },
      ],
      [
        { text: "        modified:   " },
        { text: "config/staging.json", color: "red" },
      ],
      [],
      [{ text: "Untracked files:" }],
      [
        { text: "        " },
        { text: "docs/runbook.md", color: "red" },
      ],
    ],
  },
];
