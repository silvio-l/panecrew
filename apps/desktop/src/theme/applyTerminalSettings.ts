// Schwester von applyTheme.ts, aber nur für das Hauptfenster relevant (nur
// dort laufen Terminals): schreibt `terminal.fontSize` aus dem
// Settings-Store in die CSS-Custom-Property, die `terminalTheme.ts` liest.
// Ohne dieses Modul war der Registry-Key `terminal.fontSize` (config_core.rs)
// bislang ein reines No-Op — nichts hat ihn je in --pc-terminal-fontSize
// geschrieben, weder beim Start noch live. `usePtyTerminal.ts`s
// MutationObserver beobachtet den `style`-Attribut-Wechsel auf
// `documentElement`, den `setProperty` unten auslöst, und zieht bereits
// laufende xterm-Instanzen nach.
//
// Fetch/Abo laufen seit Ticket 08 über `settingsStore.ts` (s. dessen
// Kopfkommentar) statt über ein eigenes `invoke`/`listen`.
import { getSettingsValues, subscribeToSettingsChanges } from "../settings/settingsStore";

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
  const applyFromValues = (values: Record<string, unknown>) => {
    const fontSize = values["terminal.fontSize"];
    if (typeof fontSize === "number" && Number.isFinite(fontSize)) {
      apply(fontSize);
    }
  };
  void getSettingsValues().then(applyFromValues);

  const unsubscribe = subscribeToSettingsChanges((event) => {
    if (event.key === "terminal.fontSize" && typeof event.value === "number") {
      apply(event.value);
    } else if (event.key === "*") {
      applyFromValues(event.values);
    }
  });

  return unsubscribe;
}
