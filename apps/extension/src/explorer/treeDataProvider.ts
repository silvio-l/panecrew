// Real VS Code TreeDataProvider for the PaneCrew explorer — one subtree per
// workspace folder, recursively listing files/directories via
// `vscode.workspace.fs` (not a webview, and not a hand-rolled filesystem
// walker: this closes the PoC's "no real tree" gap). Ignore handling is
// intentionally shallow, matching the brief: respect `files.exclude` /
// `search.exclude` the same way VS Code's own Explorer view reads them,
// nothing more (no bespoke `.gitignore` parser).
import * as vscode from "vscode";

export type ProjectTreeItem = FolderRootItem | FileSystemEntryItem;

export interface FolderRootItem {
  kind: "root";
  folder: vscode.WorkspaceFolder;
}

export interface FileSystemEntryItem {
  kind: "entry";
  uri: vscode.Uri;
  type: vscode.FileType;
  /** The workspace folder this entry lives under — needed to resolve
   * relative exclude-glob matches and for the "search in folder" command. */
  folder: vscode.WorkspaceFolder;
}

/** Merges `files.exclude` and `search.exclude` into one glob-pattern set —
 * same two settings, same union behavior, VS Code's own Explorer uses for
 * "should this path be hidden". Patterns with a `false` value (an explicit
 * un-exclude, e.g. a glob for the .git folder set to false in a user
 * override) are dropped rather than kept — that's the whole point of the
 * boolean value. */
function excludeGlobs(resource: vscode.Uri): string[] {
  const config = vscode.workspace.getConfiguration(undefined, resource);
  const merged: Record<string, boolean> = {
    ...(config.get<Record<string, boolean>>("files.exclude") ?? {}),
    ...(config.get<Record<string, boolean>>("search.exclude") ?? {}),
  };
  return Object.entries(merged)
    .filter(([, enabled]) => enabled)
    .map(([pattern]) => pattern);
}

/** Minimal glob matcher covering the patterns that actually show up in
 * `files.exclude`/`search.exclude` defaults and common overrides:
 * `**`/`*` segments and literal path segments. Delegates to
 * `vscode.languages`-style matching isn't available outside an editor
 * context, so this is a small hand-rolled matcher rather than pulling in a
 * glob dependency for a handful of patterns. */
function matchesGlob(relativePath: string, pattern: string): boolean {
  const segments = relativePath.split("/");
  const patternSegments = pattern.split("/");
  return matchSegments(segments, patternSegments);
}

function matchSegments(segments: string[], pattern: string[]): boolean {
  if (pattern.length === 0) return segments.length === 0;
  const [head, ...restPattern] = pattern;
  if (head === "**") {
    if (restPattern.length === 0) return true;
    for (let i = 0; i <= segments.length; i++) {
      if (matchSegments(segments.slice(i), restPattern)) return true;
    }
    return false;
  }
  if (segments.length === 0) return false;
  const [segment, ...restSegments] = segments;
  if (!matchesSegmentGlob(segment, head)) return false;
  return matchSegments(restSegments, restPattern);
}

// ⚡ Bolt optimization: memoize compiled glob patterns to avoid RegExp recompilation
const globRegexCache = new Map<string, RegExp>();

function matchesSegmentGlob(segment: string, pattern: string): boolean {
  if (pattern === "*") return true;
  let regex = globRegexCache.get(pattern);
  if (!regex) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    regex = new RegExp(`^${escaped}$`);
    globRegexCache.set(pattern, regex);
  }
  return regex.test(segment);
}

function isExcluded(uri: vscode.Uri, patterns: string[]): boolean {
  const relative = vscode.workspace.asRelativePath(uri, false);
  return patterns.some((pattern) => matchesGlob(relative, pattern));
}

export class PaneCrewTreeDataProvider implements vscode.TreeDataProvider<ProjectTreeItem> {
  // `| void` matches vscode.TreeDataProvider.onDidChangeTreeData's own
  // required signature (`Event<T | undefined | null | void>`).
  /* eslint-disable @typescript-eslint/no-invalid-void-type */
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    ProjectTreeItem | undefined | void
  >();
  /* eslint-enable @typescript-eslint/no-invalid-void-type */
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  /** The one project the explorer currently shows — the whole point of
   * "focus-following": a grid of several open projects, but exactly one
   * project tree visible at a time, matching whichever pane has focus.
   * `undefined` means "no focus signal yet" (right after activation, before
   * the first focus-follow event) — falls back to the first open folder in
   * `getChildren` below rather than showing every root at once. */
  private activeFolder: vscode.WorkspaceFolder | undefined;

  /** Per-project status line (branch, ahead/behind, dirty count, PR/CI —
   * see `git/projectStatus.ts`), keyed by workspace folder URI. Set by
   * extension.ts's periodic/event-driven refresh; `undefined`/missing means
   * "not computed yet" or "not a git repo", both of which render as no
   * description at all rather than an empty one. */
  private readonly rootDescriptions = new Map<string, string>();

  /** Doesn't fire a refresh itself — the caller updates every folder's
   * description in a loop and fires one `refresh()` afterward, so a
   * multi-project workspace doesn't re-render once per folder. */
  /** Returns whether the description actually changed, so callers that
   * batch several of these before firing a single `refresh()` (e.g. the
   * periodic project-status poll in extension.ts) can skip the refresh —
   * and the tree's visible collapse/re-expand flash — when nothing did. */
  setRootDescription(folderUri: vscode.Uri, description: string | undefined): boolean {
    const key = folderUri.toString();
    const previous = this.rootDescriptions.get(key);
    if (previous === description) return false;
    if (description) this.rootDescriptions.set(key, description);
    else this.rootDescriptions.delete(key);
    return true;
  }

  /** Switches which project's tree is shown — called by `focusFollow.ts`.
   * No-ops (skips the refresh) when it's already the active folder, so a
   * focus event that doesn't actually change projects doesn't collapse and
   * re-expand the tree the user is looking at. */
  setActiveFolder(folder: vscode.WorkspaceFolder): void {
    if (this.activeFolder?.uri.toString() === folder.uri.toString()) return;
    this.activeFolder = folder;
    this.refresh();
  }

  refresh(item?: ProjectTreeItem): void {
    this.onDidChangeTreeDataEmitter.fire(item);
  }

  getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    if (element.kind === "root") {
      const item = new vscode.TreeItem(element.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.resourceUri = element.folder.uri;
      item.description = this.rootDescriptions.get(element.folder.uri.toString());
      // Deliberately distinct from a regular subfolder's "panecrew.folder":
      // a root is a workspace folder, not a plain directory — renaming or
      // deleting it would need vscode.workspace.updateWorkspaceFolders, not
      // a filesystem rename/delete, so it must not match the same
      // context-menu `when` clauses as an ordinary folder.
      item.contextValue = "panecrew.root";
      item.iconPath = vscode.ThemeIcon.Folder;
      return item;
    }

    const isDirectory = element.type === vscode.FileType.Directory;
    const item = new vscode.TreeItem(
      element.uri,
      isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.contextValue = isDirectory ? "panecrew.folder" : "panecrew.file";
    if (!isDirectory) {
      item.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [element.uri],
      };
    }
    return item;
  }

  async getChildren(element?: ProjectTreeItem): Promise<ProjectTreeItem[]> {
    if (!element) {
      const folders = vscode.workspace.workspaceFolders ?? [];
      const active = this.activeFolder
        ? folders.find((f) => f.uri.toString() === this.activeFolder?.uri.toString())
        : undefined;
      const visible = active ? [active] : folders.slice(0, 1);
      return visible.map((folder): FolderRootItem => ({ kind: "root", folder }));
    }

    const folder = element.kind === "root" ? element.folder : element.folder;
    const dirUri = element.kind === "root" ? element.folder.uri : element.uri;

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return [];
    }

    // ⚡ Bolt optimization: lift excludeGlobs out of the filter loop
    // to avoid fetching vscode.workspace.getConfiguration for every file
    const patterns = excludeGlobs(dirUri);

    return entries
      .map(([name, type]): FileSystemEntryItem => ({
        kind: "entry",
        uri: vscode.Uri.joinPath(dirUri, name),
        type,
        folder,
      }))
      .filter((entry) => !isExcluded(entry.uri, patterns))
      .sort((a, b) => {
        const aDir = a.type === vscode.FileType.Directory;
        const bDir = b.type === vscode.FileType.Directory;
        if (aDir !== bDir) return aDir ? -1 : 1;
        return a.uri.fsPath.localeCompare(b.uri.fsPath);
      });
  }

  getParent(): vscode.ProviderResult<ProjectTreeItem> {
    // Reveal only needs to walk from a root — VS Code's `TreeView.reveal`
    // requires `getParent` to exist when revealing a non-root item, but
    // focus-follow (`focusFollow.ts`) only ever reveals root items, so a
    // trivial `undefined` is correct for those calls. A future "reveal the
    // exact active file" enhancement would need real parent tracking.
    return undefined;
  }
}
