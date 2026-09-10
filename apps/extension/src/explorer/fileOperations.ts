// Explorer context-menu file operations: rename, new file, new folder,
// delete. Closes the "context menu is thin" gap against the old desktop
// app's menu — search-in-folder, reveal-in-OS and copy-path were already
// wired (see extension.ts/package.json), these four were still missing.
import * as vscode from "vscode";
import type { FileSystemEntryItem, FolderRootItem, ProjectTreeItem } from "./treeDataProvider";
import { validateEntryName } from "./entryNameValidation";
import type { Logger } from "../logging/logger";

/** Surfaces a failed file operation to the user (VS Code would otherwise
 * just show a generic "command failed" toast with no way to search for the
 * cause) and logs it with the real error/stack for root-causing a report —
 * every mutating command below goes through this same helper. */
async function runFileOp(logger: Logger | undefined, op: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    logger?.error(`file operation failed: ${op}`, error);
    void vscode.window.showErrorMessage(
      `PaneCrew: ${op} failed — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parentUri(item: ProjectTreeItem): vscode.Uri {
  return item.kind === "root" ? item.folder.uri : vscode.Uri.joinPath(item.uri, "..");
}

function entryName(item: FileSystemEntryItem | FolderRootItem): string {
  return item.kind === "root" ? item.folder.name : (item.uri.path.split("/").pop() ?? item.uri.path);
}

async function promptForName(prompt: string, value?: string, placeHolder?: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({ prompt, value, placeHolder, validateInput: validateEntryName, ignoreFocusOut: true });
  return name?.trim();
}

export function registerRenameEntryCommand(onChanged: () => void, logger?: Logger): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.renameEntry", async (item: ProjectTreeItem | undefined) => {
    if (item?.kind !== "entry") return;
    const currentName = entryName(item);
    const newName = await promptForName(`Rename "${currentName}"`, currentName, "e.g. new-name.ts");
    if (!newName || newName === currentName) return;
    const target = vscode.Uri.joinPath(parentUri(item), newName);
    await runFileOp(logger, "rename", async () => {
      await vscode.workspace.fs.rename(item.uri, target, { overwrite: false });
      onChanged();
    });
  });
}

export function registerNewFileCommand(onChanged: () => void, logger?: Logger): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.newFile", async (item: ProjectTreeItem | undefined) => {
    if (!item) return;
    const dirUri = item.kind === "root" ? item.folder.uri : item.type === vscode.FileType.Directory ? item.uri : parentUri(item);
    const name = await promptForName("New file name", undefined, "e.g. index.ts or nested/file.ts");
    if (!name) return;
    const target = vscode.Uri.joinPath(dirUri, name);
    await runFileOp(logger, "new file", async () => {
      await vscode.workspace.fs.writeFile(target, new Uint8Array());
      onChanged();
      await vscode.window.showTextDocument(target);
    });
  });
}

export function registerNewFolderCommand(onChanged: () => void, logger?: Logger): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.newFolder", async (item: ProjectTreeItem | undefined) => {
    if (!item) return;
    const dirUri = item.kind === "root" ? item.folder.uri : item.type === vscode.FileType.Directory ? item.uri : parentUri(item);
    const name = await promptForName("New folder name", undefined, "e.g. components or nested/components");
    if (!name) return;
    await runFileOp(logger, "new folder", async () => {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dirUri, name));
      onChanged();
    });
  });
}

export function registerDeleteEntryCommand(onChanged: () => void, logger?: Logger): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.deleteEntry", async (item: ProjectTreeItem | undefined) => {
    if (item?.kind !== "entry") return;
    const name = entryName(item);
    const confirmed = await vscode.window.showWarningMessage(
      `Delete "${name}"? This moves it to the trash.`,
      { modal: true },
      "Delete",
    );
    if (confirmed !== "Delete") return;
    logger?.info("entry deleted", { kind: item.type === vscode.FileType.Directory ? "folder" : "file" });
    await runFileOp(logger, "delete", async () => {
      await vscode.workspace.fs.delete(item.uri, { recursive: true, useTrash: true });
      onChanged();
    });
  });
}

function itemUri(item: ProjectTreeItem): vscode.Uri {
  return item.kind === "root" ? item.folder.uri : item.uri;
}

/** Own command instead of referencing the built-in `copyFilePath` directly —
 * a custom TreeView's `view/item/context` menu contribution must reference a
 * command declared in *this* extension's own `commands` section (VS Code's
 * activation-time validator flags any other id there as "not defined",
 * regardless of whether it happens to be a real, globally registered
 * command — `revealFileInOS` below hit the exact same warning). */
export function registerCopyPathCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.copyPath", async (item: ProjectTreeItem | undefined) => {
    if (!item) return;
    await vscode.env.clipboard.writeText(itemUri(item).fsPath);
  });
}

/** Thin wrapper around the real built-in `revealFileInOS` — see
 * `registerCopyPathCommand`'s comment for why a wrapper is needed at all. */
export function registerRevealInOSCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.revealInOS", async (item: ProjectTreeItem | undefined) => {
    if (!item) return;
    await vscode.commands.executeCommand("revealFileInOS", itemUri(item));
  });
}
