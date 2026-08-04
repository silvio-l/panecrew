import { useState } from "react";
import { Tooltip } from "radix-ui";
import type { FileKind, Project, TreeNode } from "../mock/projects";

// Dauerhaft sichtbares, kompaktes Explorer-Panel (Struktur aus Komposition 3):
// nur der Dateibaum, kein Icon-Rail, kein Overlay. Optik an VS Codes Explorer
// angelehnt: Ordner-Chevrons, dateityp-abhängige Icon-Farben, gedämpfter
// Baum-Vordergrund mit hellerer Hervorhebung des aktiven Eintrags. Der
// Akzent-Punkt im Kopf ist das Explorer-Echo der fokussierten Pane.
// Breite/Einklapp-Zustand besitzt App (überlebt so den key-Remount pro
// Projektwechsel); der Resize-Handle sitzt ebenfalls dort.
export function ExplorerPanel({
  project,
  width,
  onCollapse,
}: {
  project: Project;
  width: number;
  onCollapse: () => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState(project.selectedFile);

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <aside
      style={{ width }}
      className="group/explorer flex shrink-0 flex-col border-r border-(--pc-explorer-border) bg-(--pc-explorer-background)"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 pl-3 pr-1.5">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-(--pc-focusBorder) shadow-[0_0_6px_var(--pc-pane-activeGlow)]"
        />
        <span className="min-w-0 flex-1 truncate text-(length:--pc-chrome-fontSize) font-semibold text-(--pc-explorerHeader-foreground)">
          {project.name}
        </span>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              aria-label="Explorer ausblenden"
              onClick={onCollapse}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-(--pc-descriptionForeground) opacity-0 transition-[opacity,color,background-color] hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) focus-visible:opacity-100 focus-visible:outline-1 focus-visible:outline-(--pc-focusBorder) group-hover/explorer:opacity-100"
            >
              <SidebarIcon />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              align="end"
              sideOffset={4}
              className="z-20 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) px-2 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) shadow-lg"
            >
              Explorer ausblenden
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {project.tree.map((node) => (
          <TreeRow
            key={node.name}
            node={node}
            path={node.name}
            depth={0}
            collapsed={collapsed}
            selected={selected}
            onToggleFolder={toggleFolder}
            onSelectFile={setSelected}
          />
        ))}
      </div>
    </aside>
  );
}

// Eingeklappter Zustand: schmale Leiste an derselben Stelle, deren Button den
// Explorer wieder einblendet — der Weg zurück bleibt damit immer sichtbar.
export function CollapsedExplorerStrip({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex w-8 shrink-0 flex-col items-center border-r border-(--pc-explorer-border) bg-(--pc-explorer-background) pt-1.5">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label="Explorer einblenden"
            onClick={onExpand}
            className="flex size-6 items-center justify-center rounded-md text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) focus-visible:outline-1 focus-visible:outline-(--pc-focusBorder)"
          >
            <SidebarIcon />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            sideOffset={4}
            className="z-20 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) px-2 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) shadow-lg"
          >
            Explorer einblenden
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  );
}

// VS-Code-artiges "Sidebar umschalten"-Glyph: Fensterrahmen mit Seitenleiste.
function SidebarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M6 2.75v10.5" />
    </svg>
  );
}

interface TreeRowProps {
  node: TreeNode;
  path: string;
  depth: number;
  collapsed: ReadonlySet<string>;
  selected: string;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
}

function TreeRow({
  node,
  path,
  depth,
  collapsed,
  selected,
  onToggleFolder,
  onSelectFile,
}: TreeRowProps) {
  const isFolder = node.children !== undefined;
  const isOpen = isFolder && !collapsed.has(path);
  const isSelected = !isFolder && selected === path;

  return (
    <>
      <button
        type="button"
        onClick={() => (isFolder ? onToggleFolder(path) : onSelectFile(path))}
        style={{ paddingLeft: 10 + depth * 12 }}
        className={`flex h-(--pc-list-rowHeight) w-full items-center gap-1.5 pr-2 text-left text-(length:--pc-chrome-fontSize) ${
          isSelected
            ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-list-activeSelectionForeground)"
            : "text-(--pc-explorer-foreground) hover:bg-(--pc-list-hoverBackground)"
        }`}
      >
        {isFolder ? (
          <Chevron open={isOpen} />
        ) : (
          <span className="w-2.5 shrink-0" />
        )}
        {isFolder ? <FolderIcon open={isOpen} /> : <FileIcon kind={node.kind} />}
        <span className="truncate">{node.name}</span>
      </button>
      {isOpen &&
        node.children?.map((child) => (
          <TreeRow
            key={child.name}
            node={child}
            path={`${path}/${child.name}`}
            depth={depth + 1}
            collapsed={collapsed}
            selected={selected}
            onToggleFolder={onToggleFolder}
            onSelectFile={onSelectFile}
          />
        ))}
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={`shrink-0 text-(--pc-descriptionForeground) transition-transform duration-100 ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M3.5 1.8 6.7 5 3.5 8.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="shrink-0"
      fill="var(--pc-icon-folder)"
      fillOpacity={open ? 0.95 : 0.8}
    >
      <path d="M1.5 3.5c0-.55.45-1 1-1h3.6l1.4 1.5h6c.55 0 1 .45 1 1v7.5c0 .55-.45 1-1 1h-11c-.55 0-1-.45-1-1v-9Z" />
    </svg>
  );
}

const FILE_KIND_COLOR: Record<FileKind, string> = {
  ts: "var(--pc-icon-blue)",
  tsx: "var(--pc-icon-blue)",
  js: "var(--pc-icon-yellow)",
  json: "var(--pc-icon-yellow)",
  rs: "var(--pc-icon-orange)",
  toml: "var(--pc-icon-gray)",
  md: "var(--pc-icon-blue)",
  css: "var(--pc-icon-purple)",
  html: "var(--pc-icon-orange)",
  sh: "var(--pc-icon-green)",
  git: "var(--pc-icon-red)",
  lock: "var(--pc-icon-gray)",
  file: "var(--pc-icon-gray)",
};

function FileIcon({ kind = "file" }: { kind?: FileKind }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      stroke={FILE_KIND_COLOR[kind]}
      strokeWidth="1.2"
    >
      <path d="M4 1.75h5.5L12.75 5v9.25a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2.25a.5.5 0 0 1 .5-.5Z" />
      <path d="M9.25 1.75V5h3.5" />
    </svg>
  );
}
