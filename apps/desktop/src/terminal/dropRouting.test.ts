import { describe, expect, it } from "vitest";
import { paneIdAtPoint, type PaneRect } from "./dropRouting";

const QUAD: readonly PaneRect[] = [
  { paneId: "top-left", rect: { left: 0, top: 0, right: 100, bottom: 100 } },
  { paneId: "top-right", rect: { left: 100, top: 0, right: 200, bottom: 100 } },
  { paneId: "bottom-left", rect: { left: 0, top: 100, right: 100, bottom: 200 } },
  {
    paneId: "bottom-right",
    rect: { left: 100, top: 100, right: 200, bottom: 200 },
  },
];

describe("paneIdAtPoint", () => {
  it("findet die Pane, deren Rechteck den Punkt enthält", () => {
    expect(paneIdAtPoint(QUAD, { x: 50, y: 50 })).toBe("top-left");
    expect(paneIdAtPoint(QUAD, { x: 150, y: 150 })).toBe("bottom-right");
  });

  it("trifft die linke/obere Kante (halboffen: >=), nicht die rechte/untere", () => {
    expect(paneIdAtPoint(QUAD, { x: 100, y: 0 })).toBe("top-right");
    expect(paneIdAtPoint(QUAD, { x: 0, y: 100 })).toBe("bottom-left");
  });

  it("liefert null außerhalb jeder Pane (Lücke, Explorer, Rand)", () => {
    expect(paneIdAtPoint(QUAD, { x: 500, y: 500 })).toBeNull();
    expect(paneIdAtPoint(QUAD, { x: -10, y: -10 })).toBeNull();
  });

  it("liefert null für ein Nullrechteck an (0, 0) — der versteckte-Pane-Fall", () => {
    const hidden: PaneRect = {
      paneId: "hidden-editor-open",
      rect: { left: 0, top: 0, right: 0, bottom: 0 },
    };
    // (0, 0) liegt geometrisch in "top-left", nicht im Nullrechteck der
    // versteckten Pane — genau die Reihenfolge-Unabhängigkeit, die die
    // halboffenen Grenzen erzwingen sollen.
    expect(paneIdAtPoint([hidden, ...QUAD], { x: 0, y: 0 })).toBe("top-left");
    expect(paneIdAtPoint([hidden], { x: 0, y: 0 })).toBeNull();
  });

  it("gibt bei überlappenden Rechtecken das zuerst gelistete zurück", () => {
    const overlapping: readonly PaneRect[] = [
      { paneId: "front", rect: { left: 0, top: 0, right: 100, bottom: 100 } },
      { paneId: "back", rect: { left: 0, top: 0, right: 200, bottom: 200 } },
    ];
    expect(paneIdAtPoint(overlapping, { x: 50, y: 50 })).toBe("front");
  });
});
