import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getSettingsValues, subscribeToSettingsChanges } from "../settings/settingsStore";
import { isMacPlatform } from "./platform";
import { matchesShortcut, SHORTCUTS, zoomAction } from "./registry";
import { DEFAULT_APP_ZOOM, nextZoomLevel } from "./zoom";

const SETTINGS_KEY = "appearance.zoom";

// App-weiter Zoom über Tauris nativen Webview-Zoom. Nicht CSS `zoom` oder eine
// veränderte Root-Font-Size: die Oberfläche mischt rem- und feste px-Maße
// (Ampel-Padding, Explorer-Breite in px), die beide nur beim echten
// Webview-Zoom gemeinsam skalieren.
//
// Der Listener hängt am `window` und nicht an xterms
// attachCustomKeyEventHandler: dort würde er ab Ticket 03 pro Pane einmal
// feuern und ohne Fokus in einer Pane gar nicht. Dass er zusätzlich die
// Pane-Kürzel sieht, ist unkritisch — die App-Einträge verlangen Shift, die
// Pane-Einträge verbieten es, matchesShortcut prüft exakt.
export function useAppZoom(): number {
  const [zoom, setZoom] = useState(DEFAULT_APP_ZOOM);
  // Persistenz lief bislang gar nicht — jeder Neustart fiel auf DEFAULT_APP_ZOOM
  // zurück. `appearance.zoom` im Settings-Store (statt localStorage, wie eine
  // ältere Notiz hier mal vorsah) macht den Wert konsistent mit
  // Theme/Sprache/Terminal-Schriftgröße UND in der Settings-UI editierbar.
  // Dieses Ref unterscheidet "ich habe selbst gerade geändert, also
  // schreiben" von "die Änderung kam von außen (Settings-Fenster), also nur
  // übernehmen" — sonst würde jede empfangene `settings:changed`-Nachricht
  // denselben Wert postwendend wieder zurückschreiben.
  const ownChangeRef = useRef(false);

  useEffect(() => {
    // `getSettingsValues()`/`subscribeToSettingsChanges()` statt eines
    // eigenen `invoke("settings_get_values")`/`listen("settings:changed")`
    // (Ticket 08) — teilt sich den einen Fetch/Listener dieses Fensters mit
    // Theme-/Sprache-/Terminal-/Aktivitäts-Applier und `useSettings`. Bewusst
    // weiterhin ohne eigene Reaktion auf den Wildcard-Key `"*"` — genau wie
    // zuvor: der Rohtext-Editor-Reset trifft praktisch nie `appearance.zoom`,
    // und ein Verhalten dafür hinzuzufügen wäre eine Funktionsänderung, die
    // dieses Ticket nicht verlangt.
    void getSettingsValues().then((values) => {
      const persisted = values[SETTINGS_KEY];
      if (typeof persisted === "number" && Number.isFinite(persisted)) {
        setZoom(persisted);
      }
    });

    const unsubscribe = subscribeToSettingsChanges((event) => {
      if (event.key === SETTINGS_KEY && typeof event.value === "number") {
        setZoom(event.value);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = isMacPlatform();
      // `zoomAction(def) !== null` grenzt gegen andere "app"-Scope-Kürzel ab
      // (z. B. das Neues-Fenster-Kürzel) — ohne das würde jedes weitere
      // App-Kürzel hier fälschlich als Zoom-Aktion gedeutet, s. Kommentar an
      // NEW_WINDOW_SHORTCUT_ID in registry.ts.
      const shortcut = SHORTCUTS.find(
        (def) =>
          def.scope === "app" &&
          zoomAction(def) !== null &&
          matchesShortcut(event, def, isMac),
      );
      if (!shortcut) return;
      // Ohne dieses preventDefault bliebe der eingebaute Webview-Zoom auf
      // derselben Taste aktiv und der Faktor wirkte doppelt.
      event.preventDefault();
      ownChangeRef.current = true;
      setZoom((current) =>
        shortcut.glyph === "0"
          ? DEFAULT_APP_ZOOM
          : nextZoomLevel(current, shortcut.glyph === "+" ? 1 : -1),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    void getCurrentWebview()
      .setZoom(zoom)
      .catch((error: unknown) => {
        console.error("PaneCrew: Oberflächen-Zoom fehlgeschlagen", error);
      });
    if (ownChangeRef.current) {
      ownChangeRef.current = false;
      void invoke("settings_set_value", { key: SETTINGS_KEY, value: zoom }).catch(
        (error: unknown) => {
          console.error("PaneCrew: Zoom-Einstellung konnte nicht gespeichert werden", error);
        },
      );
    }
  }, [zoom]);

  return zoom;
}
