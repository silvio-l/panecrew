// Zoom-Applier für Fenster ohne eigenes Zoom-Tastenkürzel (Settings, About) —
// dasselbe "ein geteilter Applier pro Fenster-Entry-Point"-Muster wie
// `applyTheme.ts`/`applyLanguage.ts` (dortiger Kommentar: "main.tsx,
// about/main.tsx, settings/main.tsx binden ihn alle auf dieselbe Weise ein").
// `appearance.zoom` hatte bislang KEIN Gegenstück dazu — `useAppZoom.ts` ist
// ein React-Hook, der nur in `App.tsx` (Haupt-/Sekundärfenster) hängt und dort
// zusätzlich die Zoom-Tastenkürzel treibt. Settings/About brauchen die
// Kürzel nicht, aber genauso wie Theme/Sprache MÜSSEN sie den aktuell
// konfigurierten Zoom übernehmen und live nachziehen, wenn er sich woanders
// ändert (2026-08-14, Nutzerbericht: "greift Zoom und sowas nicht direkt
// dynamisch drauf" im Settings-Fenster) — sonst liest sich ihr eigenes Chrome
// nicht wie derselbe Fenstertyp.
//
// Fetch/Abo laufen über `settingsStore.ts` (Ticket 08) statt über ein eigenes
// `invoke("settings_get_values")`/`listen("settings:changed")` — dasselbe
// Muster wie `applyTheme.ts`.
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getSettingsValues, subscribeToSettingsChanges } from "../settings/settingsStore";
import { DEFAULT_APP_ZOOM } from "./zoom";

const SETTINGS_KEY = "appearance.zoom";

function apply(zoom: number) {
  void getCurrentWebview()
    .setZoom(zoom)
    .catch((error: unknown) => {
      console.error("PaneCrew: Oberflächen-Zoom fehlgeschlagen", error);
    });
}

function isZoom(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Startet die Übernahme von `appearance.zoom` in dieses Fenster und hält sie
 * live: der initiale Wert plus jedes `settings:changed`-Update. Rückgabe wie
 * bei `initThemeApplier`: eine Unsubscribe-Funktion für den (praktisch nie
 * ausgelösten) Entry-Point-Cleanup.
 */
export function initZoomApplier(): () => void {
  apply(DEFAULT_APP_ZOOM);

  const applyFromValues = (values: Record<string, unknown>) => {
    const persisted = values[SETTINGS_KEY];
    if (isZoom(persisted)) {
      apply(persisted);
    }
  };
  void getSettingsValues().then(applyFromValues);

  const unsubscribe = subscribeToSettingsChanges((event) => {
    if (event.key === SETTINGS_KEY && isZoom(event.value)) {
      apply(event.value);
    } else if (event.key === "*") {
      applyFromValues(event.values);
    }
  });

  return unsubscribe;
}
