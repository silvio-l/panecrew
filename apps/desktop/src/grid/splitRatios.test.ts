import { describe, expect, it } from "vitest";
import {
  columnRatios,
  defaultRatios,
  effectiveRatios,
  gridTrackTemplate,
  normalizeRatios,
  ratioLength,
  resizeAxisRatios,
  rowRatios,
  splitterOffsetsPx,
  withColumnRatios,
  withRowRatios,
} from "./splitRatios";

describe("ratioLength", () => {
  it("ist 0 für ein Template ohne verstellbare Schnittkante (single: 1x1)", () => {
    expect(ratioLength(1, 1)).toBe(0);
  });

  it("zählt nur Achsen mit mehr als einer Spur (split: 2x1)", () => {
    expect(ratioLength(2, 1)).toBe(2);
  });

  it("addiert beide Achsen (quad: 2x2)", () => {
    expect(ratioLength(2, 2)).toBe(4);
  });

  it("row-4: 4 Spalten, 1 Zeile", () => {
    expect(ratioLength(4, 1)).toBe(4);
  });
});

describe("defaultRatios", () => {
  it("verteilt eine Achse gleichmäßig", () => {
    expect(defaultRatios(2, 1)).toEqual([0.5, 0.5]);
  });

  it("verteilt beide Achsen gleichmäßig, Spalten vor Zeilen", () => {
    expect(defaultRatios(2, 2)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("liefert eine leere Liste ohne verstellbare Achse", () => {
    expect(defaultRatios(1, 1)).toEqual([]);
  });

  it("row-3: drei gleiche Spalten-Anteile", () => {
    const ratios = defaultRatios(3, 1);
    expect(ratios).toHaveLength(3);
    ratios.forEach((r) => expect(r).toBeCloseTo(1 / 3));
  });
});

describe("normalizeRatios", () => {
  it("übernimmt eine gültige, passend lange Liste unverändert", () => {
    expect(normalizeRatios([0.3, 0.7], 2, 1)).toEqual([0.3, 0.7]);
  });

  it("fällt bei falscher Länge auf leer (Template-Default) zurück", () => {
    expect(normalizeRatios([0.3, 0.3, 0.4], 2, 1)).toEqual([]);
  });

  it("fällt bei fehlendem Wert auf leer zurück", () => {
    expect(normalizeRatios(undefined, 2, 1)).toEqual([]);
  });

  it("fällt zurück, wenn eine Achse nicht auf 1 aufsummiert", () => {
    expect(normalizeRatios([0.2, 0.2], 2, 1)).toEqual([]);
  });

  it("fällt zurück, wenn ein Wert nicht positiv ist", () => {
    expect(normalizeRatios([0, 1], 2, 1)).toEqual([]);
  });

  it("validiert Spalten- und Zeilen-Achse unabhängig (quad)", () => {
    expect(normalizeRatios([0.4, 0.6, 0.5, 0.5], 2, 2)).toEqual([0.4, 0.6, 0.5, 0.5]);
    expect(normalizeRatios([0.4, 0.6, 0.9, 0.5], 2, 2)).toEqual([]);
  });

  it("ist bei fehlender verstellbarer Achse immer leer (single)", () => {
    expect(normalizeRatios([], 1, 1)).toEqual([]);
    expect(normalizeRatios(undefined, 1, 1)).toEqual([]);
  });
});

describe("effectiveRatios", () => {
  it("nutzt gespeicherte Werte bei passender Länge", () => {
    expect(effectiveRatios([0.2, 0.8], 2, 1)).toEqual([0.2, 0.8]);
  });

  it("fällt auf Template-Default zurück, wenn leer (Template-Default-Semantik)", () => {
    expect(effectiveRatios([], 2, 1)).toEqual([0.5, 0.5]);
  });

  it("fällt auf Template-Default zurück, wenn die Länge nicht passt", () => {
    expect(effectiveRatios([0.5], 2, 2)).toEqual(defaultRatios(2, 2));
  });
});

describe("columnRatios / rowRatios", () => {
  it("liest die Spalten-Anteile aus dem flachen Array (quad: Spalten vor Zeilen)", () => {
    const flat = [0.3, 0.7, 0.4, 0.6];
    expect(columnRatios(flat, 2)).toEqual([0.3, 0.7]);
    expect(rowRatios(flat, 2, 2)).toEqual([0.4, 0.6]);
  });

  it("liefert eine leere Zeilen-Liste ohne zweite Achse (split)", () => {
    const flat = [0.3, 0.7];
    expect(columnRatios(flat, 2)).toEqual([0.3, 0.7]);
    expect(rowRatios(flat, 2, 1)).toEqual([]);
  });
});

describe("withColumnRatios / withRowRatios", () => {
  it("ersetzt nur die Spalten-Anteile, Zeilen bleiben unangetastet", () => {
    const flat = [0.3, 0.7, 0.4, 0.6];
    expect(withColumnRatios(flat, 2, 2, [0.5, 0.5])).toEqual([0.5, 0.5, 0.4, 0.6]);
  });

  it("ersetzt nur die Zeilen-Anteile, Spalten bleiben unangetastet", () => {
    const flat = [0.3, 0.7, 0.4, 0.6];
    expect(withRowRatios(flat, 2, [0.5, 0.5])).toEqual([0.3, 0.7, 0.5, 0.5]);
  });
});

describe("resizeAxisRatios", () => {
  it("verschiebt die Grenze zwischen zwei Spuren um deltaPx", () => {
    // 800px verfügbar, zwei Spuren zu je 400px (0.5/0.5) — 100px nach rechts
    // verschoben ergibt 500px/300px.
    const next = resizeAxisRatios([0.5, 0.5], 0, 100, 800, 100);
    expect(next[0]).toBeCloseTo(500 / 800);
    expect(next[1]).toBeCloseTo(300 / 800);
  });

  it("klammert auf das Mindestmaß, statt eine Spur darunter schrumpfen zu lassen", () => {
    const next = resizeAxisRatios([0.5, 0.5], 0, -1000, 800, 320);
    expect((next[0] ?? NaN) * 800).toBeCloseTo(320);
    expect((next[1] ?? NaN) * 800).toBeCloseTo(480);
  });

  it("klammert auch in die andere Richtung", () => {
    const next = resizeAxisRatios([0.5, 0.5], 0, 1000, 800, 320);
    expect((next[0] ?? NaN) * 800).toBeCloseTo(480);
    expect((next[1] ?? NaN) * 800).toBeCloseTo(320);
  });

  it("lässt eine mittlere Spur bei einer anderen Grenze unangetastet (row-4)", () => {
    const ratios = [0.25, 0.25, 0.25, 0.25];
    const next = resizeAxisRatios(ratios, 1, 100, 1600, 100);
    expect(next[0]).toBe(0.25);
    expect(next[3]).toBe(0.25);
    expect((next[1] ?? NaN) * 1600).toBeCloseTo(500);
    expect((next[2] ?? NaN) * 1600).toBeCloseTo(300);
  });

  it("bleibt unverändert, wenn der Container das Mindestmaß für beide Nachbarn nicht hergibt", () => {
    const ratios = [0.5, 0.5];
    const next = resizeAxisRatios(ratios, 0, 50, 600, 320);
    expect(next).toEqual(ratios);
  });

  it("bleibt unverändert bei einem Index außerhalb der Achse", () => {
    const ratios = [0.5, 0.5];
    expect(resizeAxisRatios(ratios, 1, 100, 800, 320)).toEqual(ratios);
    expect(resizeAxisRatios(ratios, -1, 100, 800, 320)).toEqual(ratios);
  });

  it("bleibt unverändert bei nicht-positiver Nutzfläche", () => {
    const ratios = [0.5, 0.5];
    expect(resizeAxisRatios(ratios, 0, 100, 0, 320)).toEqual(ratios);
  });
});

describe("splitterOffsetsPx", () => {
  it("platziert eine einzelne Spalten-Schnittkante in der Mitte der Lücke", () => {
    // 802px Container, 2px Lücke, zwei gleiche Spuren -> je 400px, die Kante
    // sitzt bei 400 + 1 (halbe Lücke).
    const offsets = splitterOffsetsPx([0.5, 0.5], 2, 1, 802, 600, 2);
    expect(offsets.columns).toHaveLength(1);
    expect(offsets.columns[0]).toBeCloseTo(401);
    expect(offsets.rows).toEqual([]);
  });

  it("platziert mehrere Spalten-Schnittkanten nacheinander (row-3)", () => {
    const offsets = splitterOffsetsPx(defaultRatios(3, 1), 3, 1, 1204, 600, 8);
    expect(offsets.columns).toHaveLength(2);
    expect(offsets.columns[0] ?? NaN).toBeLessThan(offsets.columns[1] ?? NaN);
  });

  it("liefert Spalten- UND Zeilen-Schnittkanten (quad)", () => {
    const offsets = splitterOffsetsPx(defaultRatios(2, 2), 2, 2, 800, 600, 8);
    expect(offsets.columns).toHaveLength(1);
    expect(offsets.rows).toHaveLength(1);
  });

  it("liefert keine Schnittkanten ohne verstellbare Achse (single)", () => {
    const offsets = splitterOffsetsPx([], 1, 1, 800, 600, 8);
    expect(offsets.columns).toEqual([]);
    expect(offsets.rows).toEqual([]);
  });
});

describe("gridTrackTemplate", () => {
  it("wandelt gleiche Anteile in gleich große `minmax(0, Nfr)`-Spuren um", () => {
    expect(gridTrackTemplate([0.5, 0.5])).toBe("minmax(0, 50fr) minmax(0, 50fr)");
  });

  it("skaliert ungleiche Anteile proportional (row-3-artig, krumme Werte)", () => {
    expect(gridTrackTemplate([0.25, 0.5, 0.25])).toBe(
      "minmax(0, 25fr) minmax(0, 50fr) minmax(0, 25fr)",
    );
  });

  it("liefert einen leeren String ohne Anteile (keine verstellbare Achse)", () => {
    expect(gridTrackTemplate([])).toBe("");
  });
});
