// Needs-Attention queue view — .scratch/attention-queue ticket 03. A second,
// flat TreeDataProvider (same shape as git/crossRepoView.ts) listing every
// pane currently signaling attention, oldest signal first, sourced from
// AttentionTracker's ordered queue read (attentionSignal.ts). Turns the
// existing attention badge from a passive indicator into an active triage
// list: clicking an entry jumps to and maximizes that pane.
import * as vscode from "vscode";
import type { AttentionNotification, AttentionTracker } from "../terminal/attentionSignal";

export interface AttentionQueueEntry {
  root: string;
  notification: AttentionNotification;
}

/** Long agent output would otherwise wrap or break the sidebar's compact,
 * scannable layout (spec.md user story 22). */
const PREVIEW_MAX_LENGTH = 60;

/** The notification's title/body as one line, or a sensible fallback for a
 * signal a CLI tool sent with neither (e.g. a bare OSC 9 with no message). */
function attentionPreviewText(notification: AttentionNotification): string {
  const parts = [notification.title, notification.body].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" — ") : "needs attention";
}

/** Truncates a one-line preview to `maxLength`, so a verbose agent message
 * never wraps or widens the sidebar row. */
function truncatePreview(text: string, maxLength = PREVIEW_MAX_LENGTH): string {
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

export class PaneCrewAttentionQueueViewProvider implements vscode.TreeDataProvider<AttentionQueueEntry> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  // Mirrors the shared `panecrew.attentionBadges.enabled` gate — the
  // Needs-Attention queue is not a second setting to keep in sync with the
  // badge/Projects-Overview glyph (spec.md user story 15).
  private enabled = true;

  constructor(private readonly tracker: AttentionTracker) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.refresh();
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(entry: AttentionQueueEntry): vscode.TreeItem {
    const projectName = entry.root.split(/[\\/]/).filter(Boolean).pop() ?? entry.root;
    const item = new vscode.TreeItem(projectName, vscode.TreeItemCollapsibleState.None);
    const preview = attentionPreviewText(entry.notification);
    item.description = truncatePreview(preview);
    item.tooltip = new vscode.MarkdownString().appendCodeblock(preview, "text");
    item.iconPath = new vscode.ThemeIcon("bell-dot", new vscode.ThemeColor("list.warningForeground"));
    item.contextValue = "panecrew.attentionQueueEntry";
    item.command = {
      command: "panecrew.jumpToAttentionPane",
      title: "Jump to Pane",
      arguments: [entry.root],
    };
    return item;
  }

  getChildren(element?: AttentionQueueEntry): AttentionQueueEntry[] {
    if (element) return [];
    if (!this.enabled) return [];
    return this.tracker.orderedQueue();
  }
}
