// Adapts a `vscode.LogOutputChannel` (the "PaneCrew" output channel) into a
// `LogSink`. `LogOutputChannel` (as opposed to a plain `OutputChannel`) is
// VS Code's own built-in structured-logging primitive: it timestamps every
// line, colors it by level, and — the key property here — its displayed
// level is user-configurable per channel via "Developer: Set Log Level…"
// (persisted, so "turn on verbose logging to diagnose a report, turn it
// back off after" is a built-in workflow, not something PaneCrew has to
// build). It's also what VS Code itself writes to disk under its own logs
// folder, so rotation/retention across sessions is VS Code's job, not
// PaneCrew's — see docs/logging.md.
import * as vscode from "vscode";
import type { LogEntry, LogSink } from "./logger";

function formatContext(entry: LogEntry): string {
  if (!entry.context) return "";
  const parts = Object.entries(entry.context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export function createOutputChannelSink(channel: vscode.LogOutputChannel): LogSink {
  return {
    emit(entry) {
      const line = `[${entry.component}] ${entry.message}${formatContext(entry)}`;
      switch (entry.level) {
        case "trace":
          channel.trace(line);
          break;
        case "debug":
          channel.debug(line);
          break;
        case "info":
          channel.info(line);
          break;
        case "warn":
          channel.warn(line);
          break;
        case "error":
          // LogOutputChannel#error accepts the Error directly and renders
          // its stack — passing entry.error (not just its .message) is
          // what makes this channel useful for root-causing a report.
          channel.error(line, entry.error);
          break;
      }
    },
  };
}
