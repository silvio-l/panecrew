import { describe, expect, it, vi } from "vitest";
import { createSelectionDragTracker } from "./selectionDrag";

describe("createSelectionDragTracker", () => {
  it("fires onOwnDragEnd when mouseup follows a mousedown on this tracker", () => {
    const tracker = createSelectionDragTracker();
    const onOwnDragEnd = vi.fn();

    tracker.onMouseDown();
    tracker.onMouseUp(onOwnDragEnd);

    expect(onOwnDragEnd).toHaveBeenCalledOnce();
  });

  it("still fires when mouseup lands outside the pane that started the drag — the whole point of a document-level listener", () => {
    const tracker = createSelectionDragTracker();
    const onOwnDragEnd = vi.fn();

    tracker.onMouseDown();
    // The mouseup itself carries no information about where it landed —
    // that's exactly why a document-level listener is needed in the first
    // place. The tracker only cares that the drag started here.
    tracker.onMouseUp(onOwnDragEnd);

    expect(onOwnDragEnd).toHaveBeenCalledOnce();
  });

  it("does not fire for a mouseup with no preceding mousedown on this tracker", () => {
    const tracker = createSelectionDragTracker();
    const onOwnDragEnd = vi.fn();

    tracker.onMouseUp(onOwnDragEnd);

    expect(onOwnDragEnd).not.toHaveBeenCalled();
  });

  it("does not fire a second time for a stray mouseup elsewhere after its own drag already concluded", () => {
    const tracker = createSelectionDragTracker();
    const onOwnDragEnd = vi.fn();

    tracker.onMouseDown();
    tracker.onMouseUp(onOwnDragEnd);
    tracker.onMouseUp(onOwnDragEnd);

    expect(onOwnDragEnd).toHaveBeenCalledOnce();
  });

  it("tracks a fresh mousedown independently after a prior drag concluded", () => {
    const tracker = createSelectionDragTracker();
    const first = vi.fn();
    const second = vi.fn();

    tracker.onMouseDown();
    tracker.onMouseUp(first);
    tracker.onMouseDown();
    tracker.onMouseUp(second);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});
