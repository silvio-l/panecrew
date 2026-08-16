import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateId } from "../grid/gridState";
import { GridSplitters } from "./GridSplitters";

// `GridSplitters` misst `workspaceRef.current` per `getBoundingClientRect()`
// (kein `getComputedStyle`-Grid in jsdom, `grid/splitRatios.ts`s
// Kopfkommentar) — ein fester 1600×800-Container mit 0 Lücke macht jede
// erwartete Pixelzahl von Hand nachrechenbar, ohne echtes Layout zu brauchen.
function stubWorkspaceRect() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1600,
    height: 800,
    top: 0,
    left: 0,
    right: 1600,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => "",
  });
}

function Harness({
  template,
  splitRatios,
  onChange,
}: {
  template: TemplateId;
  splitRatios: readonly number[];
  onChange: (ratios: readonly number[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref} />
      <GridSplitters
        template={template}
        splitRatios={splitRatios}
        onChange={onChange}
        workspaceRef={ref}
      />
    </div>
  );
}

describe("GridSplitters", () => {
  beforeEach(() => {
    stubWorkspaceRect();
  });

  it("rendert keine Schnittkante ohne verstellbare Achse (single)", () => {
    render(<Harness template="single" splitRatios={[]} onChange={vi.fn()} />);
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
  });

  it("rendert genau eine vertikale Schnittkante (split)", () => {
    render(<Harness template="split" splitRatios={[]} onChange={vi.fn()} />);
    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(1);
    expect(separators[0]).toHaveAttribute("aria-orientation", "vertical");
  });

  it("rendert je eine vertikale und horizontale Schnittkante (quad)", () => {
    render(<Harness template="quad" splitRatios={[]} onChange={vi.fn()} />);
    const orientations = screen
      .getAllByRole("separator")
      .map((el) => el.getAttribute("aria-orientation"))
      .sort();
    expect(orientations).toEqual(["horizontal", "vertical"]);
  });

  it("rendert zwei Schnittkanten für row-3 (drei Spalten)", () => {
    render(<Harness template="row-3" splitRatios={[]} onChange={vi.fn()} />);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("ArrowRight verschiebt die Spalten-Grenze um den feinen Schritt und committet sofort", () => {
    const onChange = vi.fn();
    render(<Harness template="split" splitRatios={[]} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [ratios] = onChange.mock.calls[0] as [number[]];
    // 1600px Nutzfläche, 0 Lücke, feiner Schritt 8px: 808px/792px.
    expect(ratios[0]).toBeCloseTo(808 / 1600);
    expect(ratios[1]).toBeCloseTo(792 / 1600);
  });

  it("ArrowLeft verschiebt in die andere Richtung", () => {
    const onChange = vi.fn();
    render(<Harness template="split" splitRatios={[]} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });

    const [ratios] = onChange.mock.calls[0] as [number[]];
    expect(ratios[0]).toBeCloseTo(792 / 1600);
  });

  it("Shift+Pfeiltaste nutzt den groben statt den feinen Schritt", () => {
    const onChange = vi.fn();
    render(<Harness template="split" splitRatios={[]} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("separator"), {
      key: "ArrowRight",
      shiftKey: true,
    });

    const [ratios] = onChange.mock.calls[0] as [number[]];
    // Grober Schritt 32px: 832px/768px.
    expect(ratios[0]).toBeCloseTo(832 / 1600);
  });

  it("Doppelklick setzt auf leer zurück (Template-Default, `PersistedWindow.split_ratios`s Semantik)", () => {
    const onChange = vi.fn();
    render(<Harness template="split" splitRatios={[0.3, 0.7]} onChange={onChange} />);
    fireEvent.doubleClick(screen.getByRole("separator"));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("trägt ARIA min/max/now wie der Explorer-Resize-Handle", () => {
    render(<Harness template="split" splitRatios={[]} onChange={vi.fn()} />);
    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("aria-valuemin", "320");
    expect(separator).toHaveAttribute("aria-valuemax", "1280");
    expect(separator).toHaveAttribute("aria-valuenow", "800");
  });

  it("begrenzt die vertikale Spalten-Schnittkante auf die NICHT spannende Zeile (two-over-one)", () => {
    render(<Harness template="two-over-one" splitRatios={[]} onChange={vi.fn()} />);
    const column = screen
      .getAllByRole("separator")
      .find((el) => el.getAttribute("aria-orientation") === "vertical");
    expect(column?.style.top).toBe("0px");
    expect(column?.style.height).toBe("400px");
  });

  it("spiegelbildlich bei one-over-two: die Spalten-Schnittkante liegt in der unteren Zeile", () => {
    render(<Harness template="one-over-two" splitRatios={[]} onChange={vi.fn()} />);
    const column = screen
      .getAllByRole("separator")
      .find((el) => el.getAttribute("aria-orientation") === "vertical");
    expect(column?.style.top).toBe("400px");
    expect(column?.style.height).toBe("400px");
  });

  it("fällt bei falscher Länge der gespeicherten Ratios auf das Template-Default zurück", () => {
    const onChange = vi.fn();
    // Eine Länge, die zu keinem Template passt (split braucht 2 Werte).
    render(<Harness template="split" splitRatios={[0.2, 0.3, 0.5]} onChange={onChange} />);
    const separator = screen.getByRole("separator");
    // Default (0.5/0.5) statt der kaputten gespeicherten Werte.
    expect(separator).toHaveAttribute("aria-valuenow", "800");
  });
});
