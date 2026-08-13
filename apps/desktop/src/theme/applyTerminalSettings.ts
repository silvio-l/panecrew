// Schwester von applyTheme.ts, aber nur für das Hauptfenster relevant (nur
// dort laufen Terminals): schreibt `terminal.fontSize` aus dem
// Settings-Store in die CSS-Custom-Property, die `terminalTheme.ts` liest.
// Ohne dieses Modul war der Registry-Key `terminal.fontSize` (config_core.rs)
// bislang ein reines No-Op — nichts hat ihn je in --pc-terminal-fontSize
// geschrieben, weder beim Start noch live. `usePtyTerminal.ts`s
// MutationObserver beobachtet den `style`-Attribut-Wechsel auf
// `documentElement`, den `setProperty` unten auslöst, und zieht bereits
// laufende xterm-Instanzen nach.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const TOKEN = "--pc-terminal-fontSize";

function apply(fontSize: number) {
  document.documentElement.style.setProperty(TOKEN, `${fontSize}px`);
}

/**
 * Starts applying `terminal.fontSize` as `--pc-terminal-fontSize` and keeps
 * it live via `settings:changed`. Returns an unsubscribe function for the
 * (rare, in practice never-unmounted) entry-point cleanup.
 */
export function initTerminalSettingsApplier(): () => void {
  const refreshFromBackend = () => {
    void invoke<Record<string, unknown>>("settings_get_values").then((values) => {
      const fontSize = values["terminal.fontSize"];
      if (typeof fontSize === "number" && Number.isFinite(fontSize)) {
        apply(fontSize);
      }
    });
  };
  refreshFromBackend();

  const unlistenPromise = listen<{ key: string; value: unknown }>(
    "settings:changed",
    (event) => {
      const { key, value } = event.payload;
      if (key === "terminal.fontSize" && typeof value === "number") {
        apply(value);
      } else if (key === "*") {
        refreshFromBackend();
      }
    },
  );

  return () => {
    void unlistenPromise.then((unlisten) => unlisten());
  };
}
