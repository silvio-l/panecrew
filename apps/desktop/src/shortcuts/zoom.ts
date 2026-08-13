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

export const DEFAULT_ZOOM = 1;
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
