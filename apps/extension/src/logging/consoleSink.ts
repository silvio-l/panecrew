// Dev-mode-only sink: emits every entry (including debug/trace) to the
// extension host's own console. Wired in only when `context.extensionMode
// === vscode.ExtensionMode.Development` (see setup.ts), so real users'
// installs never get it.
//
// Why this exists alongside the "PaneCrew" output channel
// (outputChannelSink.ts): that channel's *displayed* level is a
// `vscode.LogOutputChannel`'s `logLevel`, which is read-only from an
// extension's own code (VS Code deliberately gives extensions no public API
// to raise it programmatically — only the user, via "Developer: Set Log
// Level…", or VS Code's own global default). Debug/trace entries are
// therefore invisible there until someone manually turns the level up every
// session. While actively developing the extension via F5, every
// console.* call from the extension host process shows up unfiltered in the
// LAUNCHER window's own Debug Console — so mirroring log entries there gives
// full debug-level visibility without touching the output channel's
// level semantics (which stay exactly as documented/designed for real
// users) at all.
import { formatLogLine, type LogSink } from "./logger";

export function createConsoleSink(): LogSink {
  return {
    emit(entry) {
      const line = formatLogLine(entry);
      switch (entry.level) {
        case "trace":
          console.trace(line);
          break;
        case "debug":
          console.debug(line);
          break;
        case "info":
          console.info(line);
          break;
        case "warn":
          console.warn(line);
          break;
        case "error":
          if (entry.error) console.error(line, entry.error);
          else console.error(line);
          break;
      }
    },
  };
}
