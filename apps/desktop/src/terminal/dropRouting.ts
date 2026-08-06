// Reines Routing: gegeben eine Reihe von Pane-Rechtecken und einen Punkt in
// CSS-Logikpixeln, welche `paneId` (falls überhaupt eine) liegt darunter?
// Ticket 03 hebt den Drag-Drop-Listener aus `usePtyTerminal.ts` (dort pro
// Pane registriert, mit N Panes würde ein Drop in alle gleichzeitig
// schreiben) auf Grid-Ebene — dieser Teil ist die eigentliche
// Trefferprüfung, bewusst ohne DOM-Zugriff, damit er ohne jsdom testbar ist.

export interface PaneRect {
  paneId: string;
  /** `DOMRect`-kompatibel — bewusst nur die vier Felder, die die Prüfung
   * braucht, damit ein Test einfache Objektliterale übergeben kann. */
  rect: { left: number; top: number; right: number; bottom: number };
}

/**
 * Halboffene Grenzen (`>=` links/oben, `<` rechts/unten): ein verstecktes
 * Pane liefert von `getBoundingClientRect()` ein Nullrechteck
 * (`{0,0,0,0}`), und (0, 0) darf darin NICHT treffen — bei geschlossenen
 * Grenzen (`<=` auf beiden Seiten) träfe jeder Punkt bei (0, 0) genau dieses
 * Nullrechteck, ein Drop auf eine Pane mit offenem Editor (Terminal
 * `hidden`) würde also fälschlich dort landen statt zu verpuffen.
 */
export function paneIdAtPoint(
  targets: readonly PaneRect[],
  point: { x: number; y: number },
): string | null {
  for (const { paneId, rect } of targets) {
    if (
      point.x >= rect.left &&
      point.x < rect.right &&
      point.y >= rect.top &&
      point.y < rect.bottom
    ) {
      return paneId;
    }
  }
  return null;
}
