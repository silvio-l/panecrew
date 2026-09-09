import { describe, expect, test } from "vitest";
import { GRID_TEMPLATES, type GridTemplate, type TemplateId } from "./gridState";
import { gridTemplateStatusText } from "./gridStatusLabel";

function template(id: TemplateId): GridTemplate {
  const found = GRID_TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error(`Unknown template: ${id}`);
  return found;
}

const quad = template("quad");
const single = template("single");
const split = template("split");

describe("gridTemplateStatusText", () => {
  test("shows the plain template label once every slot is occupied", () => {
    expect(gridTemplateStatusText(quad, 4)).toBe("Quad (2×2)");
  });

  test("appends the occupied/total count when the template is only partially filled", () => {
    // Reported bug (2026-09-09): after a restore left only 2 of the 4 "Quad"
    // slots filled, the status bar still read plain "Quad (2×2)" with
    // nothing indicating only half the grid was actually populated.
    expect(gridTemplateStatusText(quad, 2)).toBe("Quad (2×2) — 2/4 open");
  });

  test("appends the count for a completely empty grid too", () => {
    expect(gridTemplateStatusText(quad, 0)).toBe("Quad (2×2) — 0/4 open");
  });

  test("a single-slot template with its one slot filled shows the plain label", () => {
    expect(gridTemplateStatusText(single, 1)).toBe("Single");
  });

  test("never claims more than the template's own slot count even if occupancy overshoots", () => {
    // Defensive: a stale occupiedSlotCount from a caller that hasn't
    // reconciled with a just-switched (smaller) template yet must not
    // render an impossible "3/2 open".
    expect(gridTemplateStatusText(split, 3)).toBe("Split (1×2)");
  });
});
