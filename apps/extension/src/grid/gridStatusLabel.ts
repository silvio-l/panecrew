// Pure status-bar label logic for the grid-template picker, pulled out of
// `statusBar.ts` (vscode-free, unlike that file) so it has a real vitest seam
// — mirrors `layoutController.ts`'s own pure/impure split.
import type { GridTemplate, TemplateId } from "./gridState";

const TEMPLATE_LABELS: Record<TemplateId, string> = {
  single: "Single",
  split: "Split (1×2)",
  "two-over-one": "Two over One",
  "one-over-two": "One over Two",
  "row-3": "Row of 3",
  quad: "Quad (2×2)",
  "row-4": "Row of 4",
};

export function templateLabel(template: GridTemplate): string {
  return TEMPLATE_LABELS[template.id];
}

/**
 * Status-bar text for the grid-template picker. Appends the actual
 * occupied/total slot count whenever fewer slots are filled than the
 * template provides, so the label never claims a fuller grid than what's
 * actually open.
 *
 * Bug reported 2026-09-09: after a restore left only 2 of the 4 "Quad"
 * slots filled (a template can be pre-built with empty slots the user
 * hasn't assigned a project to yet, see `layoutController.ts`'s header
 * comment), the status bar still read plain "Quad (2×2)" — indistinguishable
 * from a fully-populated grid — while the visible layout only showed the 2
 * occupied panes. The label is the one place a user checks "what grid am I
 * actually looking at", so it needs to reflect occupancy, not just the
 * chosen topology.
 *
 * `occupiedSlotCount` is clamped to `template.slotCount`: a caller passing a
 * stale count from just before a template switch to a smaller template
 * must never render an impossible "3/2 open".
 */
export function gridTemplateStatusText(
  template: GridTemplate,
  occupiedSlotCount: number,
): string {
  const label = templateLabel(template);
  const clamped = Math.min(occupiedSlotCount, template.slotCount);
  if (clamped >= template.slotCount) return label;
  return `${label} — ${clamped}/${template.slotCount} open`;
}
