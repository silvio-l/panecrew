import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, nextZoomLevel } from "./zoom";

const climb = (from: number, direction: 1 | -1, times: number) => {
  let level = from;
  for (let i = 0; i < times; i += 1) level = nextZoomLevel(level, direction);
  return level;
};

describe("nextZoomLevel", () => {
  it("geht von der Ausgangsstufe je eine Stufe nach oben und unten", () => {
    expect(nextZoomLevel(DEFAULT_ZOOM, 1)).toBeGreaterThan(DEFAULT_ZOOM);
    expect(nextZoomLevel(DEFAULT_ZOOM, -1)).toBeLessThan(DEFAULT_ZOOM);
  });

  it("bleibt an den Enden der Leiter stehen, statt überzulaufen", () => {
    const top = climb(DEFAULT_ZOOM, 1, 50);
    const bottom = climb(DEFAULT_ZOOM, -1, 50);
    expect(nextZoomLevel(top, 1)).toBe(top);
    expect(nextZoomLevel(bottom, -1)).toBe(bottom);
  });

  it("hält die Untergrenze über 0,7 — darunter sprengen die nicht mitskalierenden Ampeln die Titelzeile", () => {
    expect(climb(DEFAULT_ZOOM, -1, 50)).toBeGreaterThanOrEqual(0.8);
  });

  it("führt jede Stufe hoch wieder exakt auf ihren Ausgangswert zurück", () => {
    const up = climb(DEFAULT_ZOOM, 1, 3);
    expect(climb(up, -1, 3)).toBe(DEFAULT_ZOOM);
  });

  it("fängt einen Wert zwischen zwei Stufen auf der nächstgelegenen ab", () => {
    // Ein solcher Wert entsteht, sobald sich die Leiter selbst ändert oder ein
    // fremd gesetzter Faktor hereinkommt — er darf nicht zum Stillstand führen.
    const between = (DEFAULT_ZOOM + nextZoomLevel(DEFAULT_ZOOM, 1)) / 2;
    expect(nextZoomLevel(between, 1)).toBe(nextZoomLevel(DEFAULT_ZOOM, 1));
    expect(nextZoomLevel(between, -1)).toBe(nextZoomLevel(DEFAULT_ZOOM, -1));
  });
});
