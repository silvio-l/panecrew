// First-activation theme offer: an opt-in click, never a silent settings
// write (matters for Marketplace review, per prior product decisions carried
// over from the desktop app's own onboarding). Shown at most once per
// machine (`ExtensionContext.globalState`), independent of the walkthrough's
// own "applyTheme" step — a user who dismisses this prompt can still reach
// the same action from the walkthrough later.
import * as vscode from "vscode";
import type { Memento as GlobalMemento } from "../vscodeMemento";
export type { GlobalMemento };

const OFFERED_KEY = "panecrew.themeOffered";

export async function maybeOfferPaneCrewTheme(memento: GlobalMemento): Promise<void> {
  if (memento.get<boolean>(OFFERED_KEY)) return;
  await memento.update(OFFERED_KEY, true);

  const choice = await vscode.window.showInformationMessage(
    "PaneCrew ships two color themes tuned for terminal-heavy, multi-project work. Apply one now?",
    "PaneCrew Dark",
    "PaneCrew Light",
    "Not now",
  );
  if (choice === "PaneCrew Dark" || choice === "PaneCrew Light") {
    await applyTheme(choice);
  }
}

async function applyTheme(label: "PaneCrew Dark" | "PaneCrew Light"): Promise<void> {
  await vscode.workspace
    .getConfiguration()
    .update("workbench.colorTheme", label, vscode.ConfigurationTarget.Global);
}

/** Registers `panecrew.setPaneCrewTheme`: an explicit, user-triggered pick
 * between the two shipped themes — the walkthrough's "applyTheme" step and
 * the command palette both go through this, distinct from the
 * once-per-machine automatic offer above. */
export function registerSetThemeCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("panecrew.setPaneCrewTheme", async () => {
    const choice = await vscode.window.showQuickPick(["PaneCrew Dark", "PaneCrew Light"], {
      placeHolder: "Choose a PaneCrew theme",
      ignoreFocusOut: true,
    });
    if (choice === "PaneCrew Dark" || choice === "PaneCrew Light") {
      await applyTheme(choice);
    }
  });
}
