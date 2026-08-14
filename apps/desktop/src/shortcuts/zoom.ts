// Eine Zoomleiter für beide Ebenen: den Webview-Zoom der ganzen Oberfläche
// (Shift+Cmd/Strg) und die Schriftgröße der aktiven Terminal-Pane (Cmd/Strg).
// Beide bewegen sich in denselben Stufen, damit „eine Stufe" überall dasselbe
// bedeutet und es nur eine Grenze zu begründen gibt.
//
// Untergrenze 0,8 statt der naheliegenden 0,7: die nativen macOS-Ampeln sind
// echte Fensterelemente und skalieren NICHT mit — `setZoom` fasst nur den
// Webview-Inhalt an. Bei 0,8 ist die 36px-Titelzeile noch 28,8px hoch und
// umschließt die 12px-Knöpfe sauber, darunter dominieren sie eine Leiste, in
// der der Chrome-Text zugleich unter 10px fällt.
const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.7, 2] as const;

// Neutraler Startwert für die Leiter selbst (1 = "keine Skalierung") — bleibt
// 1, weil er auch als Reset-Ziel des PANE-Zooms dient (usePtyTerminal.ts):
// `terminal.options.fontSize = baseFontSize * paneZoomRef.current` MUSS bei
// Cmd/Strg+0 exakt die in den Einstellungen konfigurierte Schriftgröße
// ergeben, nicht 20% mehr. Für den App-weiten Chrome-Zoom gilt ein eigener,
// höherer Default — s. DEFAULT_APP_ZOOM.
export const DEFAULT_ZOOM = 1;

// App-weiter Chrome-Zoom startet bei 1,2 statt bei der neutralen 1,0
// (2026-08-14, Nutzerentscheidung): die Chrome-Schrift bei nativer Stufe war
// auf den getesteten Monitoren spürbar zu klein — 1,2 ist der von mehreren
// Bildschirmgrößen aus als Minimum bestätigte Wert, nicht die individuelle
// Vorliebe (die liegt einzelnen Nutzern zufolge auch höher, z. B. 1,4 auf
// einem größeren Monitor, bleibt aber bewusst über Shift+Cmd+= einstellbar
// statt als Default erzwungen). Eigene Konstante statt DEFAULT_ZOOM
// wiederzuverwenden: Letztere ist zugleich das PANE-Zoom-Reset-Ziel (s. o.)
// und darf dafür nicht von einer App-Chrome-Entscheidung mitgezogen werden.
export const DEFAULT_APP_ZOOM = 1.2;
export const MIN_ZOOM: number = Math.min(...ZOOM_LEVELS);
export const MAX_ZOOM: number = Math.max(...ZOOM_LEVELS);

/**
 * Die nächste Stufe in Richtung `direction` (+1 größer, -1 kleiner). An den
 * Enden der Leiter bleibt der Wert stehen, statt zu überlaufen.
 *
 * `current` muss nicht auf der Leiter liegen: gesucht wird die nächstgelegene
 * Stufe und von dort gegangen. Das hält einen aus `localStorage` gelesenen
 * oder nach einer Leiteränderung veralteten Wert benutzbar, ohne dafür eine
 * eigene Normalisierungsfunktion zu brauchen.
 */
export function nextZoomLevel(current: number, direction: 1 | -1): number {
  const nearest = ZOOM_LEVELS.reduce((best, level) =>
    Math.abs(level - current) < Math.abs(best - current) ? level : best,
  );
  const beyond = ZOOM_LEVELS.filter((level) =>
    direction === 1 ? level > nearest : level < nearest,
  );
  // Keine Stufe mehr in dieser Richtung heißt: Ende der Leiter, hier bleiben.
  return (direction === 1 ? beyond.at(0) : beyond.at(-1)) ?? nearest;
}
