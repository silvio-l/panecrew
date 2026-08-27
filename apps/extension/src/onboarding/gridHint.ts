// Live grid-state-driven onboarding nudge — the one piece of the ported
// onboarding logic (onboardingHintVariant/onboardingHintSlot) that had no
// call site. The old desktop app rendered this as a hint anchored to an
// empty grid *slot*; that surface doesn't exist in the extension model (VS
// Code gives extensions no way to draw into an empty editor group). The
// "empty" variant is covered separately by the walkthrough auto-opening on
// first activation. What's left worth doing here is the "hasPanes" nudge —
// exactly one project open, not yet at the Aha-Moment — shown at most once
// per machine, same shape as `themeOffer.ts`'s once-per-machine offer.
import * as vscode from "vscode";
import type { GridState } from "../grid/gridState";
import { onboardingHintVariant } from "./onboardingState";
import type { Memento as GlobalMemento } from "../vscodeMemento";
export type { GlobalMemento };

const SHOWN_KEY = "panecrew.gridHintShown";

export async function maybeShowGridHint(memento: GlobalMemento, state: GridState): Promise<void> {
  if (memento.get<boolean>(SHOWN_KEY)) return;
  if (onboardingHintVariant(state) !== "hasPanes") return;
  await memento.update(SHOWN_KEY, true);

  const choice = await vscode.window.showInformationMessage(
    "Add a second folder to see PaneCrew's grid in action — one terminal pane per project, side by side.",
    "Add Folder to Grid",
  );
  if (choice) await vscode.commands.executeCommand("panecrew.addFolderToGrid");
}
