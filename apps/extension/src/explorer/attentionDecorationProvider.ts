// FileDecorationProvider painting the pane-attention badge onto a project
// root's TreeItem in the PaneCrew explorer — .scratch/pane-attention-notifications.
// Registered alongside PaneCrewGitDecorationProvider, same
// vscode.FileDecorationProvider shape, but reads from AttentionTracker
// (terminal/attentionSignal.ts) instead of shelling out to git.
//
// Badge color: `notificationsInfoIcon.foreground` — a standard VS Code base
// color (not a PaneCrew-specific token), distinct from every
// COLOR_ID_BY_STATUS git-decoration color (gitStatus.ts) and from ANSI
// red/yellow/green terminal semantics. Deliberately NOT the brand's single
// reserved amber accent, which CLAUDE.md's "Brand" section reserves for
// focus/active-tab indication — reusing it here would collide with that.
import * as vscode from "vscode";
import type { AttentionTracker } from "../terminal/attentionSignal";

const ATTENTION_BADGE = "●";
const ATTENTION_COLOR_ID = "notificationsInfoIcon.foreground";

export class PaneCrewAttentionDecorationProvider implements vscode.FileDecorationProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeEmitter.event;

  private enabled = true;

  constructor(private readonly tracker: AttentionTracker) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.onDidChangeEmitter.fire(undefined);
  }

  /** Called by extension.ts after a mark/clear so the tree repaints just
   * that root — passing the specific `uri` (rather than firing `undefined`
   * for everything) avoids repainting/flashing every decorated item in the
   * explorer for a single pane's attention change. */
  notifyChanged(uri: vscode.Uri): void {
    this.onDidChangeEmitter.fire(uri);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (!this.enabled) return undefined;
    const path = uri.fsPath.replace(/\\/g, "/");
    if (!this.tracker.hasAttention(path)) return undefined;

    const notification = this.tracker.attentionFor(path);
    const parts = [notification?.title, notification?.body].filter((part): part is string => Boolean(part));
    const tooltip = parts.length > 0 ? `PaneCrew: ${parts.join(" — ")}` : "PaneCrew: needs attention";

    return {
      badge: ATTENTION_BADGE,
      color: new vscode.ThemeColor(ATTENTION_COLOR_ID),
      tooltip,
      propagate: false,
    };
  }
}
