// Ticket 08 (Perf-Audit): der eine geteilte Settings-Werte-Zugang pro Fenster
// — bislang riefen Theme-, Sprach-, Terminal- und Aktivitäts-Applier
// (theme/applyTheme.ts, theme/applyTerminalSettings.ts,
// terminal/applyActivitySettings.ts, i18n/applyLanguage.ts) sowie
// `useSettings.ts` und `useAppZoom.ts` je EIGENSTÄNDIG `settings_get_values`
// auf und abonnierten je EIGENSTÄNDIG `settings:changed` — bei allen sechs
// gleichzeitig im Hauptfenster macht das sechs Roundtrips und sechs Listener
// für exakt dieselbe Antwort. Dieses Modul ist die einzige Stelle, die
// tatsächlich `invoke("settings_get_values")` ruft und `listen("settings:
// changed", …)` registriert — jeder Consumer holt sich den aktuellen Stand
// über `getSettingsValues()` (dedupliziert gegen einen bereits laufenden
// Fetch) und hält sich über `subscribeToSettingsChanges()` live.
//
// Granulare Schreibpfade (`settings_set_value`/`settings_reset_value`) laufen
// weiterhin direkt über `useSettings.ts` — dieses Modul ist ausschließlich für
// die Lese-/Abo-Seite zuständig, nicht für Writes.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SettingValues = Record<string, unknown>;

interface RawChangedPayload {
  key: string;
  value: unknown;
}

interface SettingsChangeEvent {
  key: string;
  value: unknown;
  /** Immer der vollständige, aktuelle Werte-Stand nach Anwendung dieser
   * Änderung — beim Wildcard-Key `"*"` der frisch nachgeladene, sonst der
   * bisherige Stand mit genau diesem einen Key gemergt. Consumer, die nur den
   * einen Key brauchen, lesen `key`/`value`; Consumer wie `useSettings.ts`,
   * die bei `"*"` komplett neu laden wollen, greifen auf `values` zu. */
  values: SettingValues;
}

type ChangeListener = (event: SettingsChangeEvent) => void;

let cachedValues: SettingValues | null = null;
let fetchPromise: Promise<SettingValues> | null = null;
let listenPromise: Promise<UnlistenFn> | null = null;
const listeners = new Set<ChangeListener>();

function normalize(raw: unknown): SettingValues {
  return typeof raw === "object" && raw !== null ? (raw as SettingValues) : {};
}

async function fetchValues(): Promise<SettingValues> {
  // Bewusst ohne Typ-Parameter an `invoke`, wie zuvor in jedem einzelnen
  // Applier — ein `T`-Cast würde die reale IPC-Außengrenze nur behaupten,
  // nicht prüfen (s. dieselbe Begründung in useSettings.ts).
  const raw = await invoke("settings_get_values");
  const values = normalize(raw);
  cachedValues = values;
  return values;
}

function ensureListening(): void {
  if (listenPromise) return;
  listenPromise = listen<RawChangedPayload>("settings:changed", (event) => {
    const { key, value } = event.payload;
    if (key === "*") {
      // Der Rohtext-Editor (Ticket 07) kann viele Keys auf einmal ändern und
      // feuert dafür genau dieses eine Wildcard-Event statt eines pro Key —
      // der einzige Fall, der einen echten Reload braucht, und davon genau
      // einen, geteilt über alle Consumer, nicht einen pro Consumer.
      fetchPromise = fetchValues().finally(() => {
        fetchPromise = null;
      });
      void fetchPromise.then((values) => {
        for (const listener of listeners) listener({ key: "*", value: undefined, values });
      });
      return;
    }
    const values = { ...(cachedValues ?? {}), [key]: value };
    cachedValues = values;
    for (const listener of listeners) listener({ key, value, values });
  });
}

/**
 * Liefert den aktuellen Werte-Stand dieses Fensters. Mehrere Aufrufe, egal
 * von wie vielen Consumern, teilen sich denselben In-Flight-Request bzw. nach
 * dessen Auflösung denselben zwischengespeicherten Stand — es gibt pro
 * Fenster genau einen echten `settings_get_values`-Aufruf, nicht einen pro
 * Consumer.
 */
export function getSettingsValues(): Promise<SettingValues> {
  ensureListening();
  if (cachedValues) return Promise.resolve(cachedValues);
  fetchPromise ??= fetchValues().finally(() => {
    fetchPromise = null;
  });
  return fetchPromise;
}

/**
 * Abonniert Live-Änderungen. Registriert dabei (idempotent) den einen
 * geteilten `settings:changed`-Listener dieses Fensters, falls noch keiner
 * läuft. Gibt eine Unsubscribe-Funktion zurück.
 */
export function subscribeToSettingsChanges(listener: ChangeListener): () => void {
  ensureListening();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Nur für Tests: setzt zwischengespeicherten Stand, laufenden Fetch und die
 * Listener-Registrierung zurück, damit der nächste `getSettingsValues()`-
 * bzw. `subscribeToSettingsChanges()`-Aufruf wieder frisch fetcht und einen
 * neuen `listen()` registriert — ohne das würde der Zwischenstand eines
 * Tests unbemerkt in den nächsten `it()`-Block derselben Datei durchsickern
 * (dasselbe Leck-Risiko wie bei `resetTerminalActivityForTests`). In echten
 * Fenstern wird dieses Modul nie zurückgesetzt — der eine Fetch/Listener lebt
 * für die Lebensdauer des Fensters. */
export function resetSettingsStoreForTests(): void {
  cachedValues = null;
  fetchPromise = null;
  listenPromise = null;
  listeners.clear();
}
