import { describe, expect, it } from "vitest";
import { windowLabelAtPoint, type WindowBounds } from "./windowHitTest";

const SIDE_BY_SIDE: readonly WindowBounds[] = [
  { label: "win-a", rect: { left: 0, top: 0, right: 100, bottom: 100 } },
  { label: "win-b", rect: { left: 100, top: 0, right: 200, bottom: 100 } },
];

describe("windowLabelAtPoint", () => {
  it("finds the window whose bounds contain the cursor", () => {
    expect(windowLabelAtPoint(SIDE_BY_SIDE, { x: 50, y: 50 })).toBe("win-a");
    expect(windowLabelAtPoint(SIDE_BY_SIDE, { x: 150, y: 50 })).toBe("win-b");
  });

  it("returns null when no window is under the cursor", () => {
    expect(windowLabelAtPoint(SIDE_BY_SIDE, { x: 500, y: 500 })).toBeNull();
    expect(windowLabelAtPoint([], { x: 0, y: 0 })).toBeNull();
  });

  it("hits the shared edge on the right window's side (half-open bounds)", () => {
    // The two windows are edge-adjacent at x=100 — the boundary column must
    // belong to exactly one of them, never both and never neither.
    expect(windowLabelAtPoint(SIDE_BY_SIDE, { x: 100, y: 50 })).toBe("win-b");
    expect(windowLabelAtPoint(SIDE_BY_SIDE, { x: 99, y: 50 })).toBe("win-a");
  });

  it("returns the first-listed window when bounds overlap", () => {
    const overlapping: readonly WindowBounds[] = [
      { label: "front", rect: { left: 0, top: 0, right: 100, bottom: 100 } },
      { label: "back", rect: { left: 0, top: 0, right: 200, bottom: 200 } },
    ];
    expect(windowLabelAtPoint(overlapping, { x: 50, y: 50 })).toBe("front");
  });
});
