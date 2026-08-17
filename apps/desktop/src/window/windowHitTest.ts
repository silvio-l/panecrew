// Pure window-level hit test: given a global desktop cursor position and a
// list of known PaneCrew window bounds (Ticket 03, cross-window-drag), which
// sibling window — if any — currently sits under the cursor? Same shape as
// `terminal/dropRouting.ts`'s pane-level `paneIdAtPoint`, one level up: OS
// window bounds instead of in-window pane rects, no DOM/Tauri dependency so
// it stays testable with invented fixtures.

export interface WindowBounds {
  label: string;
  /** `DOMRect`-compatible — only the four fields the check needs, so a test
   * can pass plain object literals. */
  rect: { left: number; top: number; right: number; bottom: number };
}

/**
 * Half-open bounds (`>=` left/top, `<` right/bottom), same reasoning as
 * `paneIdAtPoint`: two edge-adjacent windows must partition their shared
 * border exactly, never double-claim or drop a pixel column between them.
 * No window-manager z-order is available from bounds alone, so overlapping
 * windows resolve by list order — first-listed wins, same convention as
 * `paneIdAtPoint`.
 */
export function windowLabelAtPoint(
  windows: readonly WindowBounds[],
  point: { x: number; y: number },
): string | null {
  for (const { label, rect } of windows) {
    if (
      point.x >= rect.left &&
      point.x < rect.right &&
      point.y >= rect.top &&
      point.y < rect.bottom
    ) {
      return label;
    }
  }
  return null;
}
