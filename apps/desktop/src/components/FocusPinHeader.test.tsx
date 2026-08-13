import { fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import { describe, expect, it, vi } from "vitest";
import { FocusPinHeader, type FocusPin } from "./FocusPinHeader";

const pins: FocusPin[] = [
  { paneId: "pane-a", slotNumber: 1, projectName: "alpha" },
  { paneId: "pane-b", slotNumber: 3, projectName: "beta" },
];

const renderPins = (
  overrides: Partial<Parameters<typeof FocusPinHeader>[0]> = {},
) => {
  const onFocusPane = vi.fn();
  render(
    <Tooltip.Provider>
      <FocusPinHeader
        pins={pins}
        focusedPaneId="pane-a"
        onFocusPane={onFocusPane}
        {...overrides}
      />
    </Tooltip.Provider>,
  );
  return { onFocusPane };
};

describe("FocusPinHeader", () => {
  it("rendert einen Pin je belegtem Slot, mit Slot-Nummer und Projektname", () => {
    renderPins();

    expect(
      screen.getByRole("button", { name: "Pane 1 fokussieren — alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pane 3 fokussieren — beta" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("markiert genau den bestromten Pin als gedrückt", () => {
    renderPins();

    expect(
      screen.getByRole("button", { name: "Pane 1 fokussieren — alpha" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Pane 3 fokussieren — beta" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("fokussiert die Pane per Klick auf ihren Pin", () => {
    // Tastatur (Enter/Space) braucht keinen eigenen Test-Pfad: die Pins sind
    // echte <button>-Elemente, deren Aktivierung der Browser selbst auf
    // Klick abbildet — genau der Grund, keine role="button"-Spans zu bauen.
    const { onFocusPane } = renderPins();

    fireEvent.click(
      screen.getByRole("button", { name: "Pane 3 fokussieren — beta" }),
    );

    expect(onFocusPane).toHaveBeenCalledWith("pane-b");
  });

  it("trägt die data-pin-pane-id, über die FocusTrace den Startpunkt misst", () => {
    renderPins();

    expect(
      screen.getByRole("button", { name: "Pane 1 fokussieren — alpha" }),
    ).toHaveAttribute("data-pin-pane-id", "pane-a");
  });

  it("rendert ohne belegte Slots gar nichts", () => {
    const { container } = render(
      <Tooltip.Provider>
        <FocusPinHeader pins={[]} focusedPaneId={null} onFocusPane={vi.fn()} />
      </Tooltip.Provider>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
