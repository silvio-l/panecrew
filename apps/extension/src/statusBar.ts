// PaneCrew's own status bar entries, shown in the PaneCrew look in place of
// the title-bar controls the old Tauri desktop app had — a VS Code extension
// has no API to add buttons to the native title bar, the status bar is the
// closest equivalent surface. Two items: the current grid template (click to
// switch) and a shortcut to open a new VS Code window. Individually hiding
// *other* contributors' status bar entries isn't possible through the
// extension API either (only the whole bar can be toggled, via
// `workbench.statusBar.visible`) — a user who wants a bare-bones status bar
// still does that per item themselves via its right-click "Hide" menu.
import * as vscode from "vscode";
import { GRID_TEMPLATES, type GridTemplate, type TemplateId } from "./grid/gridState";

const TEMPLATE_LABELS: Record<TemplateId, string> = {
  single: "Single",
  split: "Split (1×2)",
  "two-over-one": "Two over One",
  "one-over-two": "One over Two",
  "row-3": "Row of 3",
  quad: "Quad (2×2)",
  "row-4": "Row of 4",
};

function templateLabel(template: GridTemplate): string {
  return TEMPLATE_LABELS[template.id];
}

export interface GridTemplateStatusBarItem extends vscode.Disposable {
  setTemplate(template: TemplateId): void;
}

/** The grid-template picker. `onPick` is called with the chosen template id
 * once the caller (extension.ts, which owns `gridState`) should apply it —
 * this module only renders the picker and the current-state label, it
 * doesn't own grid state itself. */
export function createGridTemplateStatusBarItem(
  context: vscode.ExtensionContext,
  initialTemplate: TemplateId,
  onPick: (template: TemplateId) => void,
): GridTemplateStatusBarItem {
  const commandId = "panecrew.setGridTemplate";
  const item = vscode.window.createStatusBarItem("panecrew.gridTemplate", vscode.StatusBarAlignment.Left, 100);
  item.name = "PaneCrew: Grid Template";
  item.command = commandId;
  item.tooltip = "PaneCrew: change the grid template";

  const render = (templateId: TemplateId) => {
    const template = GRID_TEMPLATES.find((t) => t.id === templateId) ?? GRID_TEMPLATES[0];
    item.text = `$(layout) ${templateLabel(template)}`;
  };
  render(initialTemplate);
  item.show();

  const commandDisposable = vscode.commands.registerCommand(commandId, async () => {
    const picked = await vscode.window.showQuickPick(
      GRID_TEMPLATES.map((template) => ({
        label: templateLabel(template),
        description: `${template.slotCount} pane${template.slotCount === 1 ? "" : "s"}`,
        template,
      })),
      { placeHolder: "Choose a grid template" },
    );
    if (!picked) return;
    onPick(picked.template.id);
  });
  context.subscriptions.push(commandDisposable);

  return {
    setTemplate: render,
    dispose: () => {
      item.dispose();
    },
  };
}

/** Shortcut to open a new VS Code window — the closest PaneCrew-styled
 * equivalent to the desktop app's title-bar "new window" affordance. */
export function createNewWindowStatusBarItem(): vscode.Disposable {
  const item = vscode.window.createStatusBarItem("panecrew.newWindow", vscode.StatusBarAlignment.Left, 99);
  item.name = "PaneCrew: New Window";
  item.text = "$(empty-window)";
  item.tooltip = "PaneCrew: open a new window";
  item.command = "workbench.action.newWindow";
  item.show();
  return item;
}
