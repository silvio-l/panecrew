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
