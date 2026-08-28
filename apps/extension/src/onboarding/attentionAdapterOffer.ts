// First-activation offer to run `PaneCrew: Configure CLI Tool
// Notifications…` — .scratch/pane-attention-notifications user story 4.
// Same "opt-in, never applied silently" shape as themeOffer.ts: shown at
// most once per machine, an explicit click runs the same previewed/confirmed
// write flow configureNotifications.ts already gates every write behind, not
// a shortcut around it.
import * as vscode from "vscode";
import type { Memento as GlobalMemento } from "../vscodeMemento";
export type { GlobalMemento };

const OFFERED_KEY = "panecrew.attentionAdapterOffered";

export async function maybeOfferAttentionAdapterConfig(memento: GlobalMemento): Promise<void> {
  if (memento.get<boolean>(OFFERED_KEY)) return;
  await memento.update(OFFERED_KEY, true);

  const choice = await vscode.window.showInformationMessage(
    "PaneCrew can show a badge when a background pane's CLI agent needs your attention. Configure it for Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI, or OpenCode now?",
    "Configure…",
    "Not now",
  );
  if (choice === "Configure…") {
    await vscode.commands.executeCommand("panecrew.configureCliToolNotifications");
  }
}
