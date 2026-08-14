// Reine Zustandslogik für den Settings-Editor — Schema, aufgelöste Werte,
// dirty/pending-Save-Zustand, load/set/reset — von Tauri-IPC nur über
// `invoke`/`listen` abhängig, sonst ohne DOM- oder Rendering-Bezug. Direkt
// testbar über `renderHook` mit gemocktem `invoke`, im selben Schnitt wie
// `useFocusRotation.ts`.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSettingsValues, subscribeToSettingsChanges } from "./settingsStore";

type SettingType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "enum"; options: string[] };

type SettingDescription =
  | { kind: "i18nKey"; key: string }
  | { kind: "literal"; text: string };

export interface SettingSchemaEntry {
  key: string;
  type: SettingType;
  default: unknown;
  description: SettingDescription;
  /** The key's leading segment (`"terminal"` for `terminal.shell`) — the
   * grouping the category tree renders on. */
  category: string;
  source: string;
}

type SettingValues = Record<string, unknown>;

export interface UseSettingsResult {
  schema: SettingSchemaEntry[];
  values: SettingValues;
  loading: boolean;
  /** Keys with a save currently in flight — lets the UI show a pending state
   * per control instead of one global spinner. */
  pendingKeys: ReadonlySet<string>;
  error: string | null;
  setValue: (key: string, value: unknown) => Promise<void>;
  resetValue: (key: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [schema, setSchema] = useState<SettingSchemaEntry[]>([]);
  const [values, setValues] = useState<SettingValues>({});
  const [loading, setLoading] = useState(true);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // `setValue`/`resetValue` read the latest schema without depending on it —
  // otherwise every schema reload would recreate both callbacks and, through
  // them, invalidate every consumer's own `useCallback`s keyed on them.
  // Written only inside an effect (react-hooks/refs): a ref written during
  // render is a stale read for anything that rendered before it updated.
  const schemaRef = useRef<SettingSchemaEntry[]>([]);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  // Split from `load` below so the initial mount effect can call it without
  // a synchronous `setLoading(true)` in the effect's own body — `loading`
  // already starts `true` from `useState`, so the first fetch needs no
  // second synchronous flip (react-hooks/set-state-in-effect: a setState
  // call reachable before an effect's first `await` forces an extra,
  // avoidable render).
  const fetchAndApply = useCallback(async () => {
    try {
      // Bewusst ohne Typ-Parameter an `invoke` für das Schema — das reale
      // Backend liefert immer ein Array, aber ein `T`-Cast hier würde
      // TypeScript das nur GLAUBEN machen, ohne die IPC-Außengrenze
      // tatsächlich zu prüfen. Ein unvollständig gestubbter `invoke`-Mock in
      // einem Konsumenten-Test (z. B. App.test.tsx-Szenarien, die primär
      // etwas anderes prüfen und für unbekannte Kommandos pauschal
      // `undefined` liefern) träfe sonst einen `values["irgendein.key"]`-
      // Zugriff auf `undefined` statt ein leeres Objekt.
      //
      // `getSettingsValues()` statt eines eigenen `invoke("settings_get_
      // values")`: teilt sich den einen Fetch dieses Fensters mit jedem
      // anderen Consumer (Ticket 08) — dedupliziert automatisch gegen einen
      // bereits laufenden oder bereits aufgelösten Request.
      const [schemaResult, valuesResult] = await Promise.all([
        invoke("settings_get_schema"),
        getSettingsValues(),
      ]);
      setSchema(Array.isArray(schemaResult) ? (schemaResult as SettingSchemaEntry[]) : []);
      setValues(valuesResult);
      setError(null);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  // Exposed to consumers (as `reload`) and to the "*" wildcard branch of the
  // settings:changed listener below — both run from event/listener
  // callbacks, never synchronously inside an effect body, so the
  // `setLoading(true)` here is not subject to the same rule as the mount
  // effect above.
  const load = useCallback(async () => {
    setLoading(true);
    await fetchAndApply();
  }, [fetchAndApply]);

  useEffect(() => {
    void (async () => {
      await fetchAndApply();
    })();
  }, [fetchAndApply]);

  useEffect(() => {
    // `subscribeToSettingsChanges` statt eines eigenen `listen("settings:
    // changed", …)`: teilt sich den einen Listener dieses Fensters mit jedem
    // anderen Consumer (Ticket 08) — der geteilte Store hat den
    // Wildcard-Refetch (der eine `settings_get_values`-Aufruf, s.
    // settingsStore.ts) zu diesem Zeitpunkt bereits erledigt, `load()` unten
    // holt sich über `getSettingsValues()` also nur noch den bereits
    // frischen, zwischengespeicherten Stand — der zusätzliche
    // `settings_get_schema`-Aufruf bleibt hier, weil das Schema nicht Teil
    // des geteilten Stores ist.
    const unsubscribe = subscribeToSettingsChanges((event) => {
      // The raw-JSON save path (ticket 07) can change many keys at once and
      // emits this one wildcard instead of one event per key — the only case
      // that still needs a full reload.
      if (event.key === "*") {
        void load();
        return;
      }
      setValues((current) => ({ ...current, [event.key]: event.value }));
    });
    return unsubscribe;
  }, [load]);

  const setValue = useCallback(async (key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }));
    setPendingKeys((current) => new Set(current).add(key));
    try {
      await invoke("settings_set_value", { key, value });
    } catch (setError_) {
      setError(String(setError_));
      await load();
      throw setError_;
    } finally {
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [load]);

  const resetValue = useCallback(async (key: string) => {
    setPendingKeys((current) => new Set(current).add(key));
    try {
      await invoke("settings_reset_value", { key });
      const entry = schemaRef.current.find((candidate) => candidate.key === key);
      if (entry) {
        setValues((current) => ({ ...current, [key]: entry.default }));
      }
    } catch (resetError) {
      setError(String(resetError));
      await load();
      throw resetError;
    } finally {
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [load]);

  return { schema, values, loading, pendingKeys, error, setValue, resetValue, reload: load };
}
