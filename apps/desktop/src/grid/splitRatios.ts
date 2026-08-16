// Reine Zahlen-Mathematik hinter den Schnittkanten-Splittern (Ticket 21), im
// selben Schnitt wie `gridState.ts`: kein React-, kein DOM-Zugriff. jsdom
// misst kein echtes Layout (kein `getComputedStyle`-Grid, keine
// `getBoundingClientRect`-Größe) — jede Positions-/Resize-Berechnung lebt
// deshalb hier als reine Funktion über Pixelzahlen, die der Aufrufer
// (`GridSplitters.tsx`) aus EINER `getBoundingClientRect()`-Messung pro
// Pointer-Down bzw. Resize-Beobachtung gewinnt, nie aus gemessenen
// Track-Linien selbst.
//
// Kodierung (`GridState.splitRatios`/`PersistedWindow.split_ratios`): ein
// flaches Array, Spalten-Anteile zuerst, dann Zeilen-Anteile — je Achse nur,
// wenn sie mehr als eine Spur hat (`ratioLength`). Leer heißt "Template-
// Default verwenden" (`sessionState.ts`s `PersistedWindow.split_ratios`-
// Kommentar) — dieselbe Semantik trägt `GridState.splitRatios` im Live-State.

export type SplitAxis = "columns" | "rows";

function evenRatios(count: number): number[] {
  if (count <= 1) return [];
  return Array.from({ length: count }, () => 1 / count);
}

/** Gleichverteiltes Standard-Verhältnis eines Templates dieser Track-Form —
 * das, worauf ein Doppelklick auf eine Schnittkante zurücksetzt. */
export function defaultRatios(columns: number, rows: number): number[] {
  return [...evenRatios(columns), ...evenRatios(rows)];
}

/** Erwartete Länge von `split_ratios` für eine Track-Form — 0 für `single`
 * (keine verstellbare Achse), sonst Spaltenzahl + Zeilenzahl, je Achse nur
 * gezählt, wenn sie mehr als eine Spur hat. */
export function ratioLength(columns: number, rows: number): number {
  return (columns > 1 ? columns : 0) + (rows > 1 ? rows : 0);
}

const RATIO_EPSILON = 1e-6;

function isValidAxisGroup(group: readonly number[]): boolean {
  if (group.length === 0) return true;
  if (!group.every((r) => r > 0)) return false;
  const sum = group.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) < RATIO_EPSILON;
}

/** Die Spalten-Anteile aus dem flachen Array — leer ohne Spalten-Achse. */
export function columnRatios(ratios: readonly number[], columns: number): number[] {
  return columns > 1 ? ratios.slice(0, columns) : [];
}

/** Die Zeilen-Anteile aus dem flachen Array — leer ohne Zeilen-Achse. */
export function rowRatios(
  ratios: readonly number[],
  columns: number,
  rows: number,
): number[] {
  if (rows <= 1) return [];
  const offset = columns > 1 ? columns : 0;
  return ratios.slice(offset, offset + rows);
}

/** Validiert eine gespeicherte `split_ratios`-Liste gegen die Track-Form des
 * AKTUELLEN Templates (ein Restore kann ein anderes Template treffen als beim
 * Speichern) — bei falscher Länge oder ungültigen Werten (nicht-positiv, eine
 * Achse summiert nicht auf 1) fällt sie auf leer zurück, dieselbe
 * "survivable, not fatal"-Haltung wie `sessionState.ts`s `restoredTemplate`. */
export function normalizeRatios(
  stored: readonly number[] | undefined,
  columns: number,
  rows: number,
): number[] {
  const expected = ratioLength(columns, rows);
  if (expected === 0) return [];
  if (stored?.length !== expected) return [];
  if (
    !isValidAxisGroup(columnRatios(stored, columns)) ||
    !isValidAxisGroup(rowRatios(stored, columns, rows))
  ) {
    return [];
  }
  return [...stored];
}

/** Die tatsächlich wirksamen Anteile: die gespeicherten, sofern sie zur
 * Track-Form passen, sonst das gleichverteilte Standard-Verhältnis — dieselbe
 * Auflösung, die Rendering UND Resize-Mathematik gemeinsam brauchen. */
export function effectiveRatios(
  ratios: readonly number[],
  columns: number,
  rows: number,
): number[] {
  return ratios.length === ratioLength(columns, rows)
    ? [...ratios]
    : defaultRatios(columns, rows);
}

export function withColumnRatios(
  ratios: readonly number[],
  columns: number,
  rows: number,
  next: readonly number[],
): number[] {
  return [...next, ...rowRatios(ratios, columns, rows)];
}

export function withRowRatios(
  ratios: readonly number[],
  columns: number,
  next: readonly number[],
): number[] {
  return [...columnRatios(ratios, columns), ...next];
}

/** Verschiebt die Schnittkante zwischen Spur `boundaryIndex` und
 * `boundaryIndex + 1` EINER Achse um `deltaPx`, geklammert auf ein
 * Mindestmaß `minPx` je Spur. `availablePx` ist die Nutzfläche DIESER Achse
 * (Containergröße minus aller Lücken dieser Achse, nicht die volle
 * Containerbreite/-höhe) — derselbe Aufruf bedient sowohl Pointer-Drag
 * (`deltaPx` aus der Zeigerbewegung) als auch die Pfeiltasten (`deltaPx` ein
 * fester Schritt), identische Klammerung auf beiden Wegen.
 *
 * Passt ausschließlich die beiden angrenzenden Anteile an, alle anderen
 * bleiben unverändert. No-Op (neue, aber wertgleiche Liste) bei einem Index
 * außerhalb der Achse, nicht-positiver Nutzfläche, oder wenn der Container
 * das Mindestmaß für beide Nachbarn zusammen gar nicht hergibt. */
export function resizeAxisRatios(
  ratios: readonly number[],
  boundaryIndex: number,
  deltaPx: number,
  availablePx: number,
  minPx: number,
): number[] {
  if (availablePx <= 0) return [...ratios];
  if (boundaryIndex < 0 || boundaryIndex + 1 >= ratios.length) return [...ratios];
  const leftRatio = ratios[boundaryIndex];
  const rightRatio = ratios[boundaryIndex + 1];
  if (leftRatio === undefined || rightRatio === undefined) return [...ratios];

  const leftPx = leftRatio * availablePx;
  const rightPx = rightRatio * availablePx;
  const pairPx = leftPx + rightPx;
  if (pairPx < minPx * 2) return [...ratios];

  const clampedLeftPx = Math.min(pairPx - minPx, Math.max(minPx, leftPx + deltaPx));
  const clampedRightPx = pairPx - clampedLeftPx;

  const next = [...ratios];
  next[boundaryIndex] = clampedLeftPx / availablePx;
  next[boundaryIndex + 1] = clampedRightPx / availablePx;
  return next;
}

/** Wandelt Anteile einer Achse in einen `grid-template-columns`/`-rows`-Wert
 * um — `minmax(0, Nfr)` je Spur (nicht bares `Nfr`), dieselbe Begründung wie
 * die statischen `.pc-layout--*`-Regeln in `templateGlyph.css`: ohne das
 * `minmax(0, …)` könnte eine Spur nicht unter den Inhalt ihrer Zelle
 * schrumpfen und den Track sprengen. Leer (keine verstellbare Achse) liefert
 * einen leeren String — `PaneGrid.tsx` setzt das `style`-Attribut dann gar
 * nicht erst, die statische CSS-Klasse greift unverändert. */
export function gridTrackTemplate(ratios: readonly number[]): string {
  return ratios.map((r) => `minmax(0, ${r * 100}fr)`).join(" ");
}

export interface SplitterOffsetsPx {
  /** Pixel-Position (vom linken Rand) jeder Spalten-Schnittkante, mittig in
   * ihrer Lücke, in Track-Reihenfolge. */
  columns: number[];
  /** Dasselbe für Zeilen-Schnittkanten, vom oberen Rand. */
  rows: number[];
}

function cumulativeOffsets(
  ratios: readonly number[],
  availablePx: number,
  gapPx: number,
): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (let i = 0; i < ratios.length - 1; i++) {
    cursor += (ratios[i] ?? 0) * availablePx + gapPx / 2;
    offsets.push(cursor);
    cursor += gapPx / 2;
  }
  return offsets;
}

/** Die Pixel-Positionen aller Schnittkanten eines Templates — abgeleitet
 * ausschließlich aus den Anteilen (`ratios`, bereits über `effectiveRatios`
 * aufgelöst) und der Containergröße, NIE aus gemessenen Track-Linien selbst
 * (jsdom kann Letzteres nicht, s. Kopfkommentar). `ratios.length` muss
 * `ratioLength(columns, rows)` entsprechen — der Aufrufer garantiert das über
 * `effectiveRatios`. */
export function splitterOffsetsPx(
  ratios: readonly number[],
  columns: number,
  rows: number,
  containerWidthPx: number,
  containerHeightPx: number,
  gapPx: number,
): SplitterOffsetsPx {
  const cols = columnRatios(ratios, columns);
  const rws = rowRatios(ratios, columns, rows);
  const colAvailable = columns > 1 ? containerWidthPx - gapPx * (columns - 1) : 0;
  const rowAvailable = rows > 1 ? containerHeightPx - gapPx * (rows - 1) : 0;
  return {
    columns: cumulativeOffsets(cols, colAvailable, gapPx),
    rows: cumulativeOffsets(rws, rowAvailable, gapPx),
  };
}
