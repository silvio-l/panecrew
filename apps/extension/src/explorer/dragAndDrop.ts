// Explorer drag & drop: move files/folders within the PaneCrew tree by
// dragging them onto another folder (or a project root). VS Code has had
// `TreeDragAndDropController` since 1.66 — well under this extension's
// ^1.90.0 floor — so this was a straightforward gap, not a platform one.
import * as vscode from "vscode";
import type { FileSystemEntryItem, ProjectTreeItem } from "./treeDataProvider";
import { isDescendantPath } from "./pathContainment";

const MIME_TYPE = "application/vnd.code.tree.panecrew.explorerview";

function targetDirectoryUri(target: ProjectTreeItem | undefined): vscode.Uri | undefined {
  if (!target) return undefined;
  if (target.kind === "root") return target.folder.uri;
  return target.type === vscode.FileType.Directory ? target.uri : vscode.Uri.joinPath(target.uri, "..");
}

export class PaneCrewDragAndDropController implements vscode.TreeDragAndDropController<ProjectTreeItem> {
  readonly dragMimeTypes = [MIME_TYPE];
  readonly dropMimeTypes = [MIME_TYPE];

  constructor(private readonly onMoved: () => void) {}

  handleDrag(source: readonly ProjectTreeItem[], dataTransfer: vscode.DataTransfer): void {
    const entries = source.filter((item): item is FileSystemEntryItem => item.kind === "entry");
    if (entries.length === 0) return;
    dataTransfer.set(MIME_TYPE, new vscode.DataTransferItem(entries.map((entry) => entry.uri.toString())));
  }

  async handleDrop(target: ProjectTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const transferItem = dataTransfer.get(MIME_TYPE);
    if (!transferItem) return;
    const targetDirUri = targetDirectoryUri(target);
    if (!targetDirUri) return;

    const uriStrings = (await transferItem.value) as string[];
    let moved = false;
    for (const uriString of uriStrings) {
      const sourceUri = vscode.Uri.parse(uriString);
      if (isDescendantPath(sourceUri.path, targetDirUri.path)) continue;
      const name = sourceUri.path.split("/").pop();
      if (!name) continue;
      const destUri = vscode.Uri.joinPath(targetDirUri, name);
      if (destUri.toString() === sourceUri.toString()) continue;
      await vscode.workspace.fs.rename(sourceUri, destUri, { overwrite: false });
      moved = true;
    }
    if (moved) this.onMoved();
  }
}
