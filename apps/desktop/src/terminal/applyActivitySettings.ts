// Schwester von theme/applyTerminalSettings.ts, aber für terminalActivity.ts'
// zwei Schwellen (`terminal.activityIdleMs`/`terminal.activityLineThreshold`,
// config_core.rs) statt einer CSS-Custom-Property: beides reine JS-Logik-
// Werte, kein CSS-Konsument. Bewusst eigenes Modul statt der Tauri-Invoke/
// Listen-Aufrufe direkt in terminalActivity.ts: das hielte diese Datei frei
// von Tauri-Imports (terminalActivity.test.ts ruft reportOutput direkt
// auf, ohne echtes Backend) — dieses Modul ist die einzige Stelle, die
// `setActivityIdleMs`/`setActivityLineThreshold` tatsächlich aus dem
// Settings-Store befüllt.
//
// Fetch/Abo laufen seit Ticket 08 über `settingsStore.ts` (s. dessen
// Kopfkommentar) statt über ein eigenes `invoke`/`listen`.
import { getSettingsValues, subscribeToSettingsChanges } from "../settings/settingsStore";
import { setActivityIdleMs, setActivityLineThreshold } from "./terminalActivity";

const IDLE_KEY = "terminal.activityIdleMs";
const LINE_THRESHOLD_KEY = "terminal.activityLineThreshold";

function applyIfNumber(key: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  if (key === IDLE_KEY) setActivityIdleMs(value);
  else if (key === LINE_THRESHOLD_KEY) setActivityLineThreshold(value);
}

/**
 * Startet die Live-Übernahme von `terminal.activityIdleMs`/
 * `terminal.activityLineThreshold` in terminalActivity.ts und hält sie über
 * `settings:changed` aktuell. Returnt eine Unsubscribe-Funktion für den
 * (in der Praxis nie ausgehängten) Entry-Point-Cleanup.
 */
export function initTerminalActivitySettingsApplier(): () => void {
  const applyFromValues = (values: Record<string, unknown>) => {
    applyIfNumber(IDLE_KEY, values[IDLE_KEY]);
    applyIfNumber(LINE_THRESHOLD_KEY, values[LINE_THRESHOLD_KEY]);
  };
  void getSettingsValues().then(applyFromValues);

  const unsubscribe = subscribeToSettingsChanges((event) => {
    if (event.key === "*") {
      applyFromValues(event.values);
    } else {
      applyIfNumber(event.key, event.value);
    }
  });

  return unsubscribe;
}
