import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isMacPlatform } from "./platform";
import { matchesShortcut, SHORTCUTS, zoomAction } from "./registry";
import { DEFAULT_ZOOM, nextZoomLevel } from "./zoom";

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
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

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
      setZoom((current) =>
        shortcut.glyph === "0"
          ? DEFAULT_ZOOM
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
  }, [zoom]);

  return zoom;
}
