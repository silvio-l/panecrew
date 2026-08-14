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
  insertionIndexAt,
  onDrop,
  onClick,
}: {
  candidatePaneIds: readonly string[];
  insertionIndexAt?: (
    targetPaneId: string,
    point: { x: number; y: number },
  ) => number;
  onDrop: (targetPaneId: string, insertIndex: number | null) => void;
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
            insertionIndexAt,
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
      <p>{`ziel-slot:${drag.targetIndex ?? "-"}`}</p>
      <p>{`kandidaten:${drag.candidatePaneIds.join("+") || "-"}`}</p>
      {/* Die Zeigerplakette, wie die echten Aufrufer sie mounten: erst ab dem
          Scharfwerden, Startlage aus `ghostOrigin`, danach schiebt der Hook
          direkt über das Ref — als eigene Komponente mit Props, exakt das
          `TabDragGhost`-Muster (auch die Lint-Regel gegen Ref-Zugriffe im
          Render verlangt diese Trennung). */}
      {drag.ghostOrigin !== null && (
        <GhostProbe ghostRef={drag.ghostRef} origin={drag.ghostOrigin} />
      )}
      {Object.keys(PANE_RECTS).map((paneId) => (
        <div key={paneId} data-pane-id={paneId} />
      ))}
    </>
  );
}

function GhostProbe({
  ghostRef,
  origin,
}: {
  ghostRef: React.RefObject<HTMLDivElement | null>;
  origin: { x: number; y: number };
}) {
  return (
    <div
      ref={ghostRef}
      data-testid="ghost"
      style={{
        transform: `translate3d(${String(origin.x)}px, ${String(origin.y)}px, 0)`,
      }}
    />
  );
}

const setup = (
  candidatePaneIds: readonly string[] = ["pane-rechts"],
  insertionIndexAt?: (
    targetPaneId: string,
    point: { x: number; y: number },
  ) => number,
) => {
  const onDrop = vi.fn();
  const onClick = vi.fn();
  render(
    <Harness
      candidatePaneIds={candidatePaneIds}
      insertionIndexAt={insertionIndexAt}
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

    // Ohne `insertionIndexAt` (Slot-Tausch) kennt der Zug keine Positionen.
    expect(onDrop).toHaveBeenCalledWith("pane-rechts", null);
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

  it("legt die Kandidaten ab dem Scharfwerden offen und räumt sie nach dem Zug wieder weg", () => {
    // Politur-Runde (Nutzer-Befund: "er muss mir natürlich auch anzeigen, wo
    // ich ihn jetzt loslassen könnte"): die gültigen Ziele müssen SOFORT beim
    // Scharfwerden sichtbar werden können, nicht erst beim zufälligen Hover.
    const { handle } = setup(["pane-rechts"]);

    // Vor dem Scharfwerden: keine Kandidaten offengelegt.
    expect(screen.getByText("kandidaten:-")).toBeInTheDocument();
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    expect(screen.getByText("kandidaten:-")).toBeInTheDocument();

    // Scharf — noch über keinem Ziel, aber die Kandidaten stehen schon fest.
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 50 });
    expect(screen.getByText("kandidaten:pane-rechts")).toBeInTheDocument();
    expect(screen.getByText("ziel:-")).toBeInTheDocument();

    fireEvent.pointerUp(handle, { clientX: 50, clientY: 50 });
    expect(screen.getByText("kandidaten:-")).toBeInTheDocument();
  });

  it("mountet die Zeigerplakette beim Scharfwerden und führt sie über das Ref weiter", () => {
    // Regressionstest zum Nutzer-Befund "Ich muss erkennen können, dass ich
    // diesen Tab jetzt in der Hand habe": beim Umbau zum geteilten Hook war
    // das Ghost-Element des Explorer-Ziehens nicht mitgekommen.
    const { handle } = setup(["pane-rechts"]);

    expect(screen.queryByTestId("ghost")).not.toBeInTheDocument();
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 30, clientY: 40 });

    // Startlage aus `ghostOrigin` (das erste Bild) …
    const ghost = screen.getByTestId("ghost");
    expect(ghost.style.transform).toBe("translate3d(30px, 40px, 0)");
    // … danach direkt ans DOM, ohne React-Render (der Hook schreibt selbst).
    fireEvent.pointerMove(handle, { clientX: 150, clientY: 60 });
    expect(ghost.style.transform).toBe("translate3d(150px, 60px, 0)");

    fireEvent.pointerUp(handle, { clientX: 150, clientY: 60 });
    expect(screen.queryByTestId("ghost")).not.toBeInTheDocument();
  });

  it("ignoriert die sekundäre Maustaste (sie gehört den Kontextmenüs)", () => {
    const { onDrop, handle } = setup();

    fireEvent.pointerDown(handle, { button: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 150, clientY: 50 });
    fireEvent.pointerUp(handle, { clientX: 150, clientY: 50 });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("trägt eine Objekt-Quelle (Tab-Zug) genauso wie die String-Quelle des Slot-Tauschs", () => {
    // Der Hook ist generisch über die Quelle — der Slot-Tausch zieht einen
    // String (`paneId`), der Tab-Zug ein Objekt (`{paneId, tabId}`). Diese
    // zweite Instanzierung hier stellt sicher, dass Erweiterungen am
    // geteilten Hook (Ghost, Kandidaten) beide Formen weiter tragen; die
    // End-zu-End-Nachweise beider echter Gesten stehen in App.test.tsx.
    const onDrop = vi.fn();
    const seen: ({ paneId: string; tabId: string } | null)[] = [];
    function TabHarness() {
      const drag = usePaneDrag<{ paneId: string; tabId: string }>();
      seen.push(drag.source);
      return (
        <>
          <button
            type="button"
            onPointerDown={(event) => {
              drag.startDrag(event, {
                source: { paneId: "pane-links", tabId: "tab-2" },
                candidatePaneIds: ["pane-rechts"],
                onDrop,
              });
            }}
          >
            {"Chip"}
          </button>
          {Object.keys(PANE_RECTS).map((paneId) => (
            <div key={paneId} data-pane-id={paneId} />
          ))}
        </>
      );
    }
    render(<TabHarness />);
    for (const [paneId, rect] of Object.entries(PANE_RECTS)) {
      const element = document.querySelector<HTMLElement>(
        `[data-pane-id="${paneId}"]`,
      );
      if (element) element.getBoundingClientRect = () => rect;
    }
    const chip = screen.getByRole("button", { name: "Chip" });
    chip.setPointerCapture = vi.fn();
    chip.releasePointerCapture = vi.fn();
    chip.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(chip, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { clientX: 150, clientY: 50 });
    expect(seen.at(-1)).toEqual({ paneId: "pane-links", tabId: "tab-2" });
    fireEvent.pointerUp(chip, { clientX: 150, clientY: 50 });

    expect(onDrop).toHaveBeenCalledWith("pane-rechts", null);
    expect(seen.at(-1)).toBeNull();
  });

  it("führt die Einfüge-Position über `insertionIndexAt` mit und reicht sie dem Drop nach", () => {
    // Präzisions-Runde (Nutzer-Befund "ich kann nur Drop in ein Pane, aber
    // nicht an eine ganz bestimmte Stelle"): der Aufrufer übersetzt den
    // Zeigerpunkt in einen Einfüge-Slot, der Hook führt ihn als `targetIndex`
    // nach und liefert ihn beim Loslassen mit aus.
    const { onDrop, handle } = setup(["pane-rechts"], (_paneId, point) =>
      // Simple Attrappen-Geometrie: links der Pane-Mitte Slot 0, rechts 1.
      point.x < 150 ? 0 : 1,
    );

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    // Über keinem Ziel: auch kein Slot.
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 50 });
    expect(screen.getByText("ziel-slot:-")).toBeInTheDocument();

    fireEvent.pointerMove(handle, { clientX: 120, clientY: 50 });
    expect(screen.getByText("ziel-slot:0")).toBeInTheDocument();
    fireEvent.pointerMove(handle, { clientX: 180, clientY: 50 });
    expect(screen.getByText("ziel-slot:1")).toBeInTheDocument();

    fireEvent.pointerUp(handle, { clientX: 180, clientY: 50 });
    expect(onDrop).toHaveBeenCalledWith("pane-rechts", 1);
    expect(screen.getByText("ziel-slot:-")).toBeInTheDocument();
  });
});
