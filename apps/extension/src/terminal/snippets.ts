// Snippet storage + insertion command, built on the ported
// `filterSnippetCandidates` matching logic (snippetTrigger.ts). The desktop
// app's live `://` in-terminal popup (`snippetPopup.ts`) has no equivalent
// VS Code extension pattern — an extension cannot render an overlay inside a
// terminal's own screen buffer — so the UI here is a command-palette
// `showQuickPick` instead (`panecrew.insertSnippet`), documented in the
// README as an intentional adaptation, not a silent regression.
//
// Two scopes, matching VS Code's own settings-scope convention:
//   - "workspace": `.vscode/panecrew-snippets.json` in the (first) workspace
//     folder, read/written via `vscode.workspace.fs` so it works over any
//     filesystem provider VS Code supports (not just local disk).
//   - "global": `ExtensionContext.globalState`, available with no open
//     workspace at all.
import * as vscode from "vscode";
import { filterSnippetCandidates, type SnippetCandidate } from "./snippetTrigger";

type SnippetScope = "workspace" | "global";

interface StoredSnippet extends SnippetCandidate {
  scope: SnippetScope;
}

const GLOBAL_STATE_KEY = "panecrew.snippets";
const WORKSPACE_SNIPPETS_RELATIVE_PATH = ".vscode/panecrew-snippets.json";

function isSnippetArray(value: unknown): value is SnippetCandidate[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as SnippetCandidate).trigger === "string" &&
        typeof (entry as SnippetCandidate).description === "string" &&
        ((entry as SnippetCandidate).kind === "command" || (entry as SnippetCandidate).kind === "snippet"),
    )
  );
}

async function writeWorkspaceSnippets(folder: vscode.WorkspaceFolder, snippets: SnippetCandidate[]): Promise<void> {
  const uri = vscode.Uri.joinPath(folder.uri, WORKSPACE_SNIPPETS_RELATIVE_PATH);
  const dirUri = vscode.Uri.joinPath(folder.uri, ".vscode");
  try {
    await vscode.workspace.fs.createDirectory(dirUri);
  } catch {
    // Already exists — createDirectory is idempotent in intent, VS Code's
    // fs API just doesn't guarantee it never throws for "already there".
  }
  const bytes = Buffer.from(`${JSON.stringify(snippets, null, 2)}\n`, "utf8");
  await vscode.workspace.fs.writeFile(uri, bytes);
}

async function readWorkspaceSnippets(folder: vscode.WorkspaceFolder): Promise<SnippetCandidate[]> {
  const uri = vscode.Uri.joinPath(folder.uri, WORKSPACE_SNIPPETS_RELATIVE_PATH);
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return isSnippetArray(parsed) ? parsed : [];
  } catch {
    // File doesn't exist yet, or isn't valid JSON — an empty workspace
    // snippet set, not an error surfaced to the user.
    return [];
  }
}

function readGlobalSnippets(context: vscode.ExtensionContext): SnippetCandidate[] {
  const stored = context.globalState.get<SnippetCandidate[]>(GLOBAL_STATE_KEY);
  return isSnippetArray(stored) ? stored : [];
}

/** All snippets across both scopes, workspace first (closer scope wins
 * visually in the quick pick, same convention as VS Code's settings
 * precedence display, though both scopes are always shown side by side here
 * rather than one overriding the other — a snippet is additive, not a
 * setting). */
async function loadAllSnippets(context: vscode.ExtensionContext): Promise<StoredSnippet[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const workspaceSnippets = folder ? await readWorkspaceSnippets(folder) : [];
  const globalSnippets = readGlobalSnippets(context);
  return [
    ...workspaceSnippets.map((s): StoredSnippet => ({ ...s, scope: "workspace" })),
    ...globalSnippets.map((s): StoredSnippet => ({ ...s, scope: "global" })),
  ];
}

/** Registers `panecrew.insertSnippet`: a `showQuickPick` listing every
 * snippet/command across both scopes, live-filtered by
 * `filterSnippetCandidates` as the user types (VS Code's quick pick already
 * does its own fuzzy filtering, but running the same matcher the terminal's
 * `://` trigger uses keeps "what matches" consistent between the two entry
 * points). Picking a "snippet" candidate inserts its body into the active
 * terminal; a "command" candidate is left to the caller to interpret (this
 * extension currently only ships user-authored snippets, no built-in
 * commands, so command-kind entries are only reachable via
 * hand-authored `panecrew-snippets.json`). */
export function registerInsertSnippetCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.insertSnippet", async () => {
    const snippets = await loadAllSnippets(context);
    if (snippets.length === 0) {
      void vscode.window.showInformationMessage(
        "PaneCrew: no snippets saved yet. Add entries to .vscode/panecrew-snippets.json or use a global snippet.",
      );
      return;
    }

    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { snippet: StoredSnippet }>();
    quickPick.placeholder = "Filter snippets by name or description…";
    const toItems = (filter: string) =>
      filterSnippetCandidates(snippets, filter).map((snippet) => ({
        label: snippet.trigger,
        description: `[${(snippet as StoredSnippet).scope}] ${snippet.description}`,
        detail: snippet.body,
        snippet: snippet as StoredSnippet,
      }));
    quickPick.items = toItems("");
    quickPick.onDidChangeValue((value) => {
      quickPick.items = toItems(value);
    });
    quickPick.onDidAccept(() => {
      const [selected] = quickPick.selectedItems;
      quickPick.hide();
      // Defensive: vscode.QuickPick.selectedItems is a plain array TS can't
      // prove non-empty here, even though onDidAccept should only fire with
      // a selection made.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!selected) return;
      const terminal = vscode.window.activeTerminal;
      if (!terminal) {
        void vscode.window.showWarningMessage("PaneCrew: no active terminal to insert into.");
        return;
      }
      if (selected.snippet.kind === "snippet" && selected.snippet.body) {
        terminal.sendText(selected.snippet.body, false);
      }
    });
    quickPick.onDidHide(() => { quickPick.dispose(); });
    quickPick.show();
  });
}

/** Registers `panecrew.createSnippet`: the in-editor authoring path the
 * quick pick above never had — previously the only way to add a snippet was
 * hand-editing `.vscode/panecrew-snippets.json`, undiscoverable unless you
 * already knew the file existed. Walks trigger → description → body → scope
 * via a short sequence of input boxes/quick pick, then appends to whichever
 * store the chosen scope uses. */
export function registerCreateSnippetCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.createSnippet", async () => {
    const trigger = await vscode.window.showInputBox({
      prompt: "Trigger text (what you'll type after :// to bring this up)",
      placeHolder: "e.g. deploy",
      validateInput: (value) => (value.trim() ? undefined : "Trigger can't be empty."),
      ignoreFocusOut: true,
    });
    if (!trigger) return;

    const description = await vscode.window.showInputBox({
      prompt: "Short description (shown in the picker)",
      placeHolder: "e.g. Run the deploy script",
      validateInput: (value) => (value.trim() ? undefined : "Description can't be empty."),
      ignoreFocusOut: true,
    });
    if (!description) return;

    const body = await vscode.window.showInputBox({
      prompt: "Text to insert into the terminal",
      placeHolder: "e.g. ./scripts/deploy.sh",
      validateInput: (value) => (value.trim() ? undefined : "Snippet body can't be empty."),
      ignoreFocusOut: true,
    });
    if (!body) return;

    const defaultScope = vscode.workspace
      .getConfiguration("panecrew")
      .get<SnippetScope>("snippets.defaultScope", "workspace");
    const folder = vscode.workspace.workspaceFolders?.[0];
    const scopePick = folder
      ? await vscode.window.showQuickPick(
          [
            { label: "Workspace", description: WORKSPACE_SNIPPETS_RELATIVE_PATH, scope: "workspace" as const },
            { label: "Global", description: "Available in every workspace", scope: "global" as const },
          ],
          { placeHolder: "Where should this snippet be saved?", ignoreFocusOut: true },
        )
      : undefined;
    const scope: SnippetScope = folder ? (scopePick?.scope ?? defaultScope) : "global";
    if (folder && !scopePick) return;

    const newSnippet: SnippetCandidate = { trigger: trigger.trim(), description: description.trim(), body, kind: "snippet" };

    if (scope === "workspace" && folder) {
      const existing = await readWorkspaceSnippets(folder);
      await writeWorkspaceSnippets(folder, [...existing, newSnippet]);
    } else {
      const existing = readGlobalSnippets(context);
      await context.globalState.update(GLOBAL_STATE_KEY, [...existing, newSnippet]);
    }

    void vscode.window.showInformationMessage(`PaneCrew: saved snippet "${trigger}" (${scope}).`);
  });
}
