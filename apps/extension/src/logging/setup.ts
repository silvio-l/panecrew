// Wires the pure logger core (logger.ts) to its two sinks for a real
// extension host: the always-on "PaneCrew" output channel, and the opt-in
// Sentry sink. Kept separate from extension.ts so activate() stays mostly
// wiring-of-modules, matching that file's existing convention.
import * as os from "node:os";
import * as vscode from "vscode";
import { combineSinks, createLogger, type Logger } from "./logger";
import { createConsoleSink } from "./consoleSink";
import { createOutputChannelSink } from "./outputChannelSink";
import { createSentrySink } from "./sentrySink";
import { PANECREW_SENTRY_DSN } from "./sentryConfig";

/** Consent for Sentry error reporting requires BOTH PaneCrew's own setting
 * (default off — see package.json's `panecrew.diagnostics.errorReporting`)
 * AND VS Code's own global telemetry level (`telemetry.telemetryLevel`,
 * exposed as `vscode.env.isTelemetryEnabled`) — a user who has disabled
 * telemetry at the editor level is never enrolled by a per-extension
 * setting alone. */
function sentryReportingAllowed(): boolean {
  const ownSetting = vscode.workspace.getConfiguration("panecrew").get<boolean>("diagnostics.errorReporting", false);
  return ownSetting && vscode.env.isTelemetryEnabled;
}

export interface RootLogger {
  logger: Logger;
  channel: vscode.LogOutputChannel;
}

export function createRootLogger(context: vscode.ExtensionContext): RootLogger {
  const channel = vscode.window.createOutputChannel("PaneCrew", { log: true });
  context.subscriptions.push(channel);

  const outputSink = createOutputChannelSink(channel);
  const version = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";
  const environment = context.extensionMode === vscode.ExtensionMode.Development ? "development" : "production";

  const sinks = [outputSink];
  // Full debug/trace visibility while developing PaneCrew itself (F5) via
  // the launcher window's own Debug Console — see consoleSink.ts for why
  // this can't just be "raise the output channel's level instead".
  if (environment === "development") {
    sinks.push(createConsoleSink());
  }
  if (sentryReportingAllowed()) {
    const sentrySink = createSentrySink({ dsn: PANECREW_SENTRY_DSN, release: version, environment });
    if (sentrySink) sinks.push(sentrySink);
  }

  const logger = createLogger(sinks.length > 1 ? combineSinks(...sinks) : outputSink, "panecrew", os.homedir());

  // Re-evaluate consent on every relevant setting change rather than
  // requiring "reload window" — cheap (the extension is re-activated only
  // once per window either way) and matches how the rest of PaneCrew's
  // config-driven toggles (e.g. attentionBadges.enabled) behave.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("panecrew.diagnostics.errorReporting")) {
        logger.info("diagnostics.errorReporting setting changed — restart PaneCrew (reload window) for it to take effect");
      }
    }),
  );

  return { logger, channel };
}
