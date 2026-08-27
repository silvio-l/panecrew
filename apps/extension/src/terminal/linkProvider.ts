// `vscode.window.registerTerminalLinkProvider` implementation wired to the
// ported `detectTerminalLinks` (terminalLinkDetect.ts) — same link-detection
// regex/logic as the desktop app's xterm.js addon, just adapted to VS Code's
// own terminal-link protocol (a link per matched line, opened via
// `vscode.env.openExternal` for URLs or `vscode.window.showTextDocument` for
// absolute paths).
import * as vscode from "vscode";
import { detectTerminalLinks, type TerminalLink } from "./terminalLinkDetect";

export interface PaneCrewTerminalLink extends vscode.TerminalLink {
  panecrewLink: TerminalLink;
}

export class PaneCrewTerminalLinkProvider
  implements vscode.TerminalLinkProvider<PaneCrewTerminalLink>
{
  provideTerminalLinks(context: vscode.TerminalLinkContext): PaneCrewTerminalLink[] {
    return detectTerminalLinks(context.line).map((link) => ({
      startIndex: link.start,
      length: link.end - link.start,
      tooltip: link.type === "url" ? "Open URL" : "Open File",
      panecrewLink: link,
    }));
  }

  async handleTerminalLink(link: PaneCrewTerminalLink): Promise<void> {
    const { type, text } = link.panecrewLink;
    if (type === "url") {
      await vscode.env.openExternal(vscode.Uri.parse(text));
      return;
    }
    try {
      const uri = vscode.Uri.file(text);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch {
      // Path no longer exists, or isn't a regular file (e.g. a directory) —
      // silently ignored, same as VS Code's own built-in terminal link
      // provider does for a link that fails to resolve.
    }
  }
}
