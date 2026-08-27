// Explorer context-menu file operations: rename, new file, new folder,
// delete. Closes the "context menu is thin" gap against the old desktop
// app's menu — search-in-folder, reveal-in-OS and copy-path were already
// wired (see extension.ts/package.json), these four were still missing.
import * as vscode from "vscode";
import type { FileSystemEntryItem, FolderRootItem, ProjectTreeItem } from "./treeDataProvider";
import { validateEntryName } from "./entryNameValidation";

function parentUri(item: ProjectTreeItem): vscode.Uri {
  return item.kind === "root" ? item.folder.uri : vscode.Uri.joinPath(item.uri, "..");
}

function entryName(item: FileSystemEntryItem | FolderRootItem): string {
  return item.kind === "root" ? item.folder.name : (item.uri.path.split("/").pop() ?? item.uri.path);
}

async function promptForName(prompt: string, value?: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({ prompt, value, validateInput: validateEntryName });
  return name?.trim();
}

export function registerRenameEntryCommand(onChanged: () => void): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.renameEntry", async (item: ProjectTreeItem | undefined) => {
    if (item?.kind !== "entry") return;
    const currentName = entryName(item);
    const newName = await promptForName(`Rename "${currentName}"`, currentName);
    if (!newName || newName === currentName) return;
    const target = vscode.Uri.joinPath(parentUri(item), newName);
    await vscode.workspace.fs.rename(item.uri, target, { overwrite: false });
    onChanged();
  });
}

export function registerNewFileCommand(onChanged: () => void): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.newFile", async (item: ProjectTreeItem | undefined) => {
    if (!item) return;
    const dirUri = item.kind === "root" ? item.folder.uri : item.type === vscode.FileType.Directory ? item.uri : parentUri(item);
    const name = await promptForName("New file name");
    if (!name) return;
    const target = vscode.Uri.joinPath(dirUri, name);
    await vscode.workspace.fs.writeFile(target, new Uint8Array());
    onChanged();
    await vscode.window.showTextDocument(target);
  });
}

export function registerNewFolderCommand(onChanged: () => void): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.newFolder", async (item: ProjectTreeItem | undefined) => {
    if (!item) return;
    const dirUri = item.kind === "root" ? item.folder.uri : item.type === vscode.FileType.Directory ? item.uri : parentUri(item);
    const name = await promptForName("New folder name");
    if (!name) return;
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dirUri, name));
    onChanged();
  });
}

export function registerDeleteEntryCommand(onChanged: () => void): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.deleteEntry", async (item: ProjectTreeItem | undefined) => {
    if (item?.kind !== "entry") return;
    const name = entryName(item);
    const confirmed = await vscode.window.showWarningMessage(
      `Delete "${name}"? This moves it to the trash.`,
      { modal: true },
      "Delete",
    );
    if (confirmed !== "Delete") return;
    await vscode.workspace.fs.delete(item.uri, { recursive: true, useTrash: true });
    onChanged();
  });
}
