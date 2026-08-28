// Impure shell around the three pure adapters (claudeCode.ts, codexCli.ts,
// geminiCli.ts): the `PaneCrew: Configure CLI Tool Notifications…` command's
// quick pick / diff preview / explicit confirm / write flow —
// .scratch/pane-attention-notifications ticket 04. This is PaneCrew's first
// feature that writes to a file outside its own project workspace, so every
// write goes through this same gate: read, compute, show a real diff
// editor, ask for an explicit confirmation, only then write — never silent,
// never a guess at which tool/scope to touch.
import * as vscode from "vscode";
import * as os from "node:os";
import { computePatchedConfig as computeClaudeCodeConfig } from "./claudeCode";
import { computePatchedConfig as computeCodexConfig } from "./codexCli";
import { computePatchedConfig as computeGeminiCliConfig } from "./geminiCli";
import { computePatchedConfig as computeCopilotCliConfig } from "./copilotCli";
import { computePatchedConfig as computeOpenCodeConfig } from "./openCode";
import type { PatchResult } from "./jsonHookPatch";

interface BaseTool {
  id: string;
  label: string;
  /** `false` means the tool has no adapter yet — selecting it explains why
   * instead of attempting a write (ticket 06 requirement). */
  supported: boolean;
  unsupportedReason?: string;
  /** Relative-to-project ("`.claude/settings.json`") or absolute
   * ("`~/.codex/config.toml`") description shown in the quick pick and
   * messages. */
  displayPath: string;
  computePatchedConfig?: (existingConfigText: string | undefined) => PatchResult;
}

/** A project-scoped tool's `configUri` needs an actual workspace folder — no
 * `folder!` non-null assertion needed at the call site, since TypeScript
 * narrows `tool` by `scope` before either variant's `configUri` is called. */
interface ProjectScopedTool extends BaseTool {
  scope: "project";
  configUri: (folder: vscode.WorkspaceFolder) => vscode.Uri;
}

interface UserScopedTool extends BaseTool {
  scope: "user";
  configUri: () => vscode.Uri;
}

type CliAdapterTool = ProjectScopedTool | UserScopedTool;

const TOOLS: CliAdapterTool[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    supported: true,
    scope: "project",
    displayPath: ".claude/settings.json",
    computePatchedConfig: computeClaudeCodeConfig,
    configUri: (folder) => vscode.Uri.joinPath(folder.uri, ".claude", "settings.json"),
  },
  {
    id: "codex",
    label: "Codex CLI",
    supported: true,
    scope: "user",
    displayPath: "~/.codex/config.toml",
    computePatchedConfig: computeCodexConfig,
    configUri: () => vscode.Uri.file(`${os.homedir()}/.codex/config.toml`),
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    supported: true,
    scope: "project",
    displayPath: ".gemini/settings.json",
    computePatchedConfig: computeGeminiCliConfig,
    configUri: (folder) => vscode.Uri.joinPath(folder.uri, ".gemini", "settings.json"),
  },
  {
    id: "copilot-cli",
    label: "GitHub Copilot CLI",
    supported: true,
    scope: "project",
    displayPath: ".github/hooks/panecrew-attention.json",
    computePatchedConfig: computeCopilotCliConfig,
    configUri: (folder) => vscode.Uri.joinPath(folder.uri, ".github", "hooks", "panecrew-attention.json"),
  },
  {
    id: "opencode",
    label: "OpenCode",
    supported: true,
    scope: "project",
    displayPath: ".opencode/plugins/panecrew-attention.js",
    computePatchedConfig: computeOpenCodeConfig,
    configUri: (folder) => vscode.Uri.joinPath(folder.uri, ".opencode", "plugins", "panecrew-attention.js"),
  },
];

/** In-memory content provider backing the diff-preview editor — never
 * touches disk itself, just renders the "before"/"after" strings this
 * module already computed. */
class DiffPreviewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contentByUri = new Map<string, string>();

  set(uri: vscode.Uri, content: string): void {
    this.contentByUri.set(uri.toString(), content);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentByUri.get(uri.toString()) ?? "";
  }
}

const DIFF_SCHEME = "panecrew-cli-adapter-preview";

async function readExistingConfig(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("PaneCrew: no project is open to configure — add a folder to the grid first.");
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, folder })),
    { placeHolder: "Which project's config should PaneCrew configure?" },
  ).then((picked) => picked?.folder);
}

export function registerConfigureCliToolNotificationsCommand(context: vscode.ExtensionContext): vscode.Disposable {
  const previewProvider = new DiffPreviewContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, previewProvider));

  return vscode.commands.registerCommand("panecrew.configureCliToolNotifications", async () => {
    const picked = await vscode.window.showQuickPick(
      TOOLS.map((tool) => ({
        label: tool.label,
        description: tool.supported ? tool.displayPath : "not yet supported",
        tool,
      })),
      { placeHolder: "Configure attention notifications for which CLI tool?" },
    );
    if (!picked) return;
    const tool = picked.tool;

    if (!tool.supported || !tool.computePatchedConfig) {
      void vscode.window.showInformationMessage(
        tool.unsupportedReason ?? `PaneCrew: ${tool.label} doesn't have a notification adapter yet.`,
      );
      return;
    }

    let uri: vscode.Uri;
    if (tool.scope === "project") {
      const folder = await pickWorkspaceFolder();
      if (!folder) return;
      uri = tool.configUri(folder);
    } else {
      uri = tool.configUri();
    }
    const existing = await readExistingConfig(uri);

    let result: PatchResult;
    try {
      result = tool.computePatchedConfig(existing);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return;
    }

    if (!result.changed) {
      void vscode.window.showInformationMessage(
        `PaneCrew: ${tool.label} is already configured for attention notifications (${tool.displayPath}).`,
      );
      return;
    }

    const beforeUri = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${tool.id}/before` });
    const afterUri = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${tool.id}/after` });
    previewProvider.set(beforeUri, existing ?? "");
    previewProvider.set(afterUri, result.text);
    await vscode.commands.executeCommand(
      "vscode.diff",
      beforeUri,
      afterUri,
      `PaneCrew: Configure ${tool.label} Notifications — Preview (${tool.displayPath})`,
    );

    const confirmed = await vscode.window.showWarningMessage(
      `Write this change to ${tool.displayPath}?`,
      { modal: true, detail: existing === undefined ? "This file doesn't exist yet and will be created." : "The diff you just reviewed will be written to disk." },
      "Write Change",
    );
    if (confirmed !== "Write Change") return;

    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(result.text));
    void vscode.window.showInformationMessage(`PaneCrew: configured ${tool.label} notifications (${tool.displayPath}).`);
  });
}
