// Reine Geometrie der Fokus-Leiterbahn (FocusTrace.tsx): Bus-Route vom
// Pin-Header an der Explorer-Naht zum Pad auf der Oberkante der fokussierten
// Pane, plus 45°-Fasen-Pfad und Signal-Laufzeit. Kein React-, kein DOM-Import
// — derselbe Schnitt wie `grid/gridState.ts`: die Komponente misst Rechtecke,
// dieses Modul rechnet nur mit Zahlen und bleibt damit ohne jsdom-Layout
// testbar (jsdom liefert für getBoundingClientRect nur Nullen).
//
// Alle Koordinaten sind CSS-Logikpixel im Rahmen des Overlay-SVGs — die
// Umrechnung von Viewport-Rechtecken dorthin macht der Aufrufer.

export interface TracePoint {
  x: number;
  y: number;
}

/** 45°-Fase an jedem Knick statt harter 90°-Ecken — die klassische
 * Leiterbahn-Silhouette. 6px sind klein genug, um in den 8px-Kanälen
 * (Grid-`gap`, `main`-Padding) zu bleiben. */
export const TRACE_CHAMFER_PX = 6;
/** Signal-Laufzeit-Optik: die Leitung baut sich mit konstanter Geschwindigkeit
 * auf, längere Wege dauern proportional länger — geklemmt, damit weder ein
 * Nachbar-Pane-Wechsel unsichtbar kurz noch eine Diagonale durchs ganze
 * Fenster zäh wird. Nicht exportiert (anders als die Klemmgrenzen): außerhalb
 * von `traceDurationMs` rechnet niemand mit der Geschwindigkeit selbst. */
const TRACE_SPEED_PX_PER_MS = 2;
export const TRACE_MIN_DURATION_MS = 180;
export const TRACE_MAX_DURATION_MS = 350;
/** Abstand der Route zu den Kanten, an denen sie entlangläuft: der vertikale
 * Bus-Kanal liegt 4px links der Grid-Fläche (im 8px-Padding von `<main>`),
 * der Quer-Kanal 4px über der Ziel-Pane (mittig im 8px-Grid-`gap` bzw. im
 * Abstand zur Statuszeile). */
export const TRACE_CHANNEL_OFFSET_PX = 4;
/** Wie weit das Pad von der linken Pane-Kante einrückt — unter dem Bereich
 * des ❯-Chevrons im Pane-Header, nicht mittig: die Leitung soll als Zubringer
 * an der Kante lesbar bleiben, nicht als Unterstreichung des Titels. */
export const TRACE_PAD_INSET_PX = 24;
export const TRACE_PAD_WIDTH_PX = 8;
export const TRACE_PAD_HEIGHT_PX = 4;

/** Manhattan-Route Pin → Pad in Bus-Führung: horizontal von der Naht in den
 * vertikalen Kanal links vor dem Grid, darin auf die Höhe des Quer-Kanals
 * über der Ziel-Pane, quer bis zur Pad-Spalte, kurzer Abgang aufs Pad.
 * Degenerierte Stücke (Pin bereits auf Kanalhöhe o. ä.) fallen über
 * `simplify` weg statt Sonderfälle zu verzweigen. */
export function busRoutePoints(opts: {
  pin: TracePoint;
  paneLeft: number;
  paneTop: number;
  paneWidth: number;
  workspaceLeft: number;
}): TracePoint[] {
  const busX = opts.workspaceLeft - TRACE_CHANNEL_OFFSET_PX;
  const channelY = opts.paneTop - TRACE_CHANNEL_OFFSET_PX;
  // Bei sehr schmalen Panes rückt das Pad höchstens bis zur Mitte ein.
  const padX = opts.paneLeft + Math.min(TRACE_PAD_INSET_PX, opts.paneWidth / 2);
  return simplify([
    opts.pin,
    { x: busX, y: opts.pin.y },
    { x: busX, y: channelY },
    { x: padX, y: channelY },
    { x: padX, y: opts.paneTop },
  ]);
}

/** Entfernt praktisch identische Nachbarpunkte und kollineare Zwischenpunkte
 * — beides entstünde sonst als 0px-Segment mit sichtbarer Doppel-Fase. */
function simplify(points: readonly TracePoint[]): TracePoint[] {
  const deduped: TracePoint[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.5) continue;
    deduped.push(point);
  }
  const out: TracePoint[] = [];
  for (const point of deduped) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (a && b) {
      const cross =
        (b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x);
      const dot = (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y);
      // Kollinear UND gleiche Richtung: b ist reiner Zwischenpunkt. Eine
      // Kehrtwende (dot < 0) bleibt dagegen als echter Knick stehen.
      if (Math.abs(cross) < 0.5 && dot > 0) out.pop();
    }
    out.push(point);
  }
  return out;
}

/** Der gefaste Linienzug als Punktfolge: an jedem Knick weichen Ein- und
 * Austritt um die (auf die halbe Segmentlänge geklemmte) Fasenweite zurück —
 * zwischen ihnen entsteht bei axis-aligned Segmenten genau die 45°-Fase. */
function chamferedPolyline(
  points: readonly TracePoint[],
  chamfer: number,
): TracePoint[] {
  if (points.length < 3) return [...points];
  const out: TracePoint[] = [points[0] as TracePoint];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1] as TracePoint;
    const vertex = points[i] as TracePoint;
    const next = points[i + 1] as TracePoint;
    const inLen = Math.hypot(vertex.x - prev.x, vertex.y - prev.y);
    const outLen = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    // Halbe Segmentlänge als Obergrenze: zwei Fasen an den Enden desselben
    // Segments dürfen sich nie überlappen.
    const cut = Math.min(chamfer, inLen / 2, outLen / 2);
    out.push(
      {
        x: vertex.x - ((vertex.x - prev.x) / inLen) * cut,
        y: vertex.y - ((vertex.y - prev.y) / inLen) * cut,
      },
      {
        x: vertex.x + ((next.x - vertex.x) / outLen) * cut,
        y: vertex.y + ((next.y - vertex.y) / outLen) * cut,
      },
    );
  }
  out.push(points[points.length - 1] as TracePoint);
  return out;
}

/** SVG-`d`-Attribut des gefasten Linienzugs. Auf 2 Nachkommastellen gerundet
 * — Sub-Pixel-Rauschen aus getBoundingClientRect soll das Attribut nicht bei
 * jedem Messen um Mikrodifferenzen ändern. */
export function chamferedPathD(
  points: readonly TracePoint[],
  chamfer: number,
): string {
  const line = chamferedPolyline(points, chamfer);
  if (line.length < 2) return "";
  return line
    .map((p, i) => `${i === 0 ? "M" : "L"} ${round2(p.x)} ${round2(p.y)}`)
    .join(" ");
}

/** Länge des gefasten Linienzugs — analytisch statt per
 * `path.getTotalLength()`, damit Dauer-Berechnung und Tests ohne echtes
 * SVG-Layout auskommen (jsdom hat getTotalLength nicht). */
export function chamferedLength(
  points: readonly TracePoint[],
  chamfer: number,
): number {
  const line = chamferedPolyline(points, chamfer);
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1] as TracePoint;
    const b = line[i] as TracePoint;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Aufbaudauer der Leitung: Weglänge / 2px-pro-ms, geklemmt auf 180–350ms. */
export function traceDurationMs(length: number): number {
  return Math.round(
    Math.min(
      TRACE_MAX_DURATION_MS,
      Math.max(TRACE_MIN_DURATION_MS, length / TRACE_SPEED_PX_PER_MS),
    ),
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
