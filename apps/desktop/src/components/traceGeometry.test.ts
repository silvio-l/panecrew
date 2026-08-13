import { describe, expect, it } from "vitest";
import {
  busRoutePoints,
  chamferedLength,
  chamferedPathD,
  traceDurationMs,
  TRACE_CHANNEL_OFFSET_PX,
  TRACE_MAX_DURATION_MS,
  TRACE_MIN_DURATION_MS,
  TRACE_PAD_INSET_PX,
} from "./traceGeometry";

describe("busRoutePoints", () => {
  it("führt vom Pin über Bus- und Quer-Kanal zum Pad auf der Pane-Oberkante", () => {
    const points = busRoutePoints({
      pin: { x: 8, y: 100 },
      paneLeft: 28,
      paneTop: 40,
      paneWidth: 400,
      workspaceLeft: 20,
    });

    expect(points).toEqual([
      { x: 8, y: 100 },
      { x: 20 - TRACE_CHANNEL_OFFSET_PX, y: 100 },
      { x: 20 - TRACE_CHANNEL_OFFSET_PX, y: 40 - TRACE_CHANNEL_OFFSET_PX },
      { x: 28 + TRACE_PAD_INSET_PX, y: 40 - TRACE_CHANNEL_OFFSET_PX },
      { x: 28 + TRACE_PAD_INSET_PX, y: 40 },
    ]);
  });

  it("rückt das Pad bei sehr schmalen Panes nur bis zur Pane-Mitte ein", () => {
    const points = busRoutePoints({
      pin: { x: 8, y: 100 },
      paneLeft: 28,
      paneTop: 40,
      paneWidth: 20,
      workspaceLeft: 20,
    });

    const pad = points[points.length - 1];
    expect(pad).toEqual({ x: 28 + 10, y: 40 });
  });

  it("kollabiert degenerierte Segmente, wenn der Pin bereits auf Kanalhöhe liegt", () => {
    // Pin-Mitte exakt auf der Höhe des Quer-Kanals über der Pane: der
    // vertikale Bus-Abschnitt hat Länge 0 und darf im Ergebnis weder als
    // Doppelpunkt noch als kollinearer Zwischenpunkt auftauchen.
    const points = busRoutePoints({
      pin: { x: 8, y: 36 },
      paneLeft: 28,
      paneTop: 40,
      paneWidth: 400,
      workspaceLeft: 20,
    });

    expect(points).toEqual([
      { x: 8, y: 36 },
      { x: 28 + TRACE_PAD_INSET_PX, y: 36 },
      { x: 28 + TRACE_PAD_INSET_PX, y: 40 },
    ]);
  });
});

describe("chamferedPathD", () => {
  it("lässt eine gerade Strecke ungefast", () => {
    expect(
      chamferedPathD(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        6,
      ),
    ).toBe("M 0 0 L 100 0");
  });

  it("ersetzt einen 90°-Knick durch eine 45°-Fase", () => {
    expect(
      chamferedPathD(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        6,
      ),
    ).toBe("M 0 0 L 94 0 L 100 6 L 100 100");
  });

  it("klemmt die Fase auf die halbe Länge kurzer Segmente", () => {
    // Mittelsegment nur 8px lang: beide Fasen daran dürfen zusammen nie
    // länger als das Segment selbst sein — je 4px statt 6px.
    expect(
      chamferedPathD(
        [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 8, y: 100 },
        ],
        6,
      ),
    ).toBe("M 0 0 L 4 0 L 8 4 L 8 100");
  });

  it("liefert für weniger als zwei Punkte einen leeren Pfad", () => {
    expect(chamferedPathD([{ x: 3, y: 3 }], 6)).toBe("");
    expect(chamferedPathD([], 6)).toBe("");
  });
});

describe("chamferedLength", () => {
  it("misst die gefaste Strecke: pro Ecke ersetzt die Diagonale beide Fasenstücke", () => {
    // L-Route 100 + 100 = 200; eine 6px-Fase spart 2·6 und ersetzt sie durch
    // die Diagonale 6·√2.
    const length = chamferedLength(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      6,
    );
    expect(length).toBeCloseTo(200 - 12 + 6 * Math.SQRT2, 6);
  });
});

describe("traceDurationMs", () => {
  it("skaliert mit 2px pro Millisekunde", () => {
    expect(traceDurationMs(500)).toBe(250);
  });

  it("klemmt kurze Wege auf das Minimum", () => {
    expect(traceDurationMs(10)).toBe(TRACE_MIN_DURATION_MS);
  });

  it("klemmt lange Wege auf das Maximum", () => {
    expect(traceDurationMs(5000)).toBe(TRACE_MAX_DURATION_MS);
  });
});
