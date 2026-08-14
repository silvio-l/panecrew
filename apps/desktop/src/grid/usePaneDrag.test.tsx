import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePaneDrag } from "./usePaneDrag";

// Riskant an dieser Geste ist ihre Mechanik, nicht ihr Aussehen: Schwelle,
// Klick-Unterdrückung und vor allem die Frage, WELCHE Panes überhaupt
// getroffen werden dürfen (der Tab-Zug erlaubt nur Panes desselben Projekts,
// Ticket 32 — eine Ablehnung erst beim Loslassen wäre zu spät). Genau das
// steht hier.
//
// jsdom hat kein Layout: die Ziel-Rechtecke werden deshalb direkt an den
// `[data-pane-id]`-Attrappen unten untergeschoben, exakt die Elemente, die
// der Hook per `document.querySelector` sucht.
const PANE_RECTS: Record<string, DOMRect> = {
  "pane-links": { left: 0, top: 0, right: 100, bottom: 100 } as DOMRect,
  "pane-rechts": { left: 100, top: 0, right: 200, bottom: 100 } as DOMRect,
};

function Harness({
  candidatePaneIds,
  onDrop,
  onClick,
}: {
  candidatePaneIds: readonly string[];
  onDrop: (targetPaneId: string) => void;
  onClick: () => void;
}) {
  const drag = usePaneDrag<string>();
  return (
    <>
      <button
        type="button"
        onPointerDown={(event) => {
          drag.startDrag(event, {
            source: "pane-links",
            candidatePaneIds,
            onDrop,
          });
        }}
        onClick={() => {
          if (drag.consumeDragClick()) return;
          onClick();
        }}
      >
        {"Griff"}
      </button>
      <p>{`quelle:${drag.source ?? "-"}`}</p>
      <p>{`ziel:${drag.targetPaneId ?? "-"}`}</p>
      {Object.keys(PANE_RECTS).map((paneId) => (
        <div key={paneId} data-pane-id={paneId} />
      ))}
    </>
  );
}

const setup = (candidatePaneIds: readonly string[] = ["pane-rechts"]) => {
  const onDrop = vi.fn();
  const onClick = vi.fn();
  render(
    <Harness
      candidatePaneIds={candidatePaneIds}
      onDrop={onDrop}
      onClick={onClick}
    />,
  );
  for (const [paneId, rect] of Object.entries(PANE_RECTS)) {
    const element = document.querySelector<HTMLElement>(
      `[data-pane-id="${paneId}"]`,
    );
    if (element) element.getBoundingClientRect = () => rect;
  }
  const handle = screen.getByRole("button", { name: "Griff" });
  // jsdom kennt die Pointer-Capture-Methoden nicht — Attrappen statt eines
  // Verzichts im Produktivcode: im echten Webview ist das Capture die
  // Bedingung dafür, dass der Zug das Verlassen des Griffs überlebt
  // (Begründung im Hook).
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  handle.hasPointerCapture = vi.fn(() => true);
  return { onDrop, onClick, handle };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePaneDrag", () => {
  it("liefert die Pane unter dem Zeiger und schluckt den Abschlussklick", () => {
    const { onDrop, onClick, handle } = setup();

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 150, clientY: 50 });
    expect(screen.getByText("quelle:pane-links")).toBeInTheDocument();
    expect(screen.getByText("ziel:pane-rechts")).toBeInTheDocument();
    fireEvent.pointerUp(handle, { clientX: 150, clientY: 50 });
    // Das Pointer-Capture führt den Klick zum Griff zurück, auch wenn über
    // der Ziel-Pane losgelassen wurde.
    fireEvent.click(handle);

    expect(onDrop).toHaveBeenCalledWith("pane-rechts");
    expect(onClick).not.toHaveBeenCalled();
    // Nach dem Ende ist der Zug vollständig aufgeräumt.
    expect(screen.getByText("quelle:-")).toBeInTheDocument();
    expect(screen.getByText("ziel:-")).toBeInTheDocument();
  });

  it("bleibt bei minimalem Zittern ein Klick, statt zu ziehen", () => {
    const { onDrop, onClick, handle } = setup();

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    // 2px — unter der Schwelle.
    fireEvent.pointerMove(handle, { clientX: 12, clientY: 11 });
    fireEvent.pointerUp(handle, { clientX: 12, clientY: 11 });
    fireEvent.click(handle);

    expect(onDrop).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("trifft eine Pane nicht, die nicht als Ziel zugelassen ist", () => {
    // Ein leeres Kandidatenfeld bedeutet: es gibt kein gültiges Ziel — die
    // Geste darf dann gar nicht erst scharf werden (der Zug einer einzigen
    // Pane im Grid, der einzige Tab einer Pane).
    const { onDrop, onClick, handle } = setup([]);

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 150, clientY: 50 });
    fireEvent.pointerUp(handle, { clientX: 150, clientY: 50 });
    fireEvent.click(handle);

    expect(onDrop).not.toHaveBeenCalled();
    expect(screen.getByText("quelle:-")).toBeInTheDocument();
    // Ohne Ziel bleibt es ein gewöhnlicher Klick — die Geste verschluckt ihn
    // nicht ersatzweise.
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("meldet kein Ziel, solange der Zeiger über einer nicht zugelassenen Pane steht", () => {
    // "pane-links" liegt unter dem Zeiger, ist aber nicht zugelassen (im
    // Tab-Zug etwa: anderes Projekt) — die Ablehnung passiert beim Schweben,
    // nicht erst beim Loslassen.
    const { onDrop, handle } = setup(["pane-rechts"]);

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 50 });
    expect(screen.getByText("ziel:-")).toBeInTheDocument();
    fireEvent.pointerUp(handle, { clientX: 50, clientY: 50 });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("lässt den nächsten echten Klick zu, nachdem ein Zug abgebrochen wurde", () => {
    const { onDrop, onClick, handle } = setup();

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 150, clientY: 50 });
    fireEvent.pointerCancel(handle, { clientX: 150, clientY: 50 });

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handle, { clientX: 10, clientY: 10 });
    fireEvent.click(handle);

    expect(onDrop).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ignoriert die sekundäre Maustaste (sie gehört den Kontextmenüs)", () => {
    const { onDrop, handle } = setup();

    fireEvent.pointerDown(handle, { button: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 150, clientY: 50 });
    fireEvent.pointerUp(handle, { clientX: 150, clientY: 50 });

    expect(onDrop).not.toHaveBeenCalled();
  });
});
