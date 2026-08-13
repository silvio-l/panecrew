import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useExplorerPathDrag } from "./useExplorerPathDrag";
import type { PaneDropRegistration } from "./useWebviewFileDrop";

// Die Mechanik dieses Vorgangs ist das Riskante daran, nicht sein Aussehen:
// Schwelle, Klick-Unterdrückung und die Frage, WELCHER Pfad im Terminal
// landet. Genau das steht hier — mit einer Attrappe als Registrierung, denn
// die echte hängt an Tauris Webview-API.
const dropRegistration = (
  paneAtPoint: (point: { x: number; y: number }) => string | null,
) => ({
  register: vi.fn<PaneDropRegistration["register"]>(),
  unregister: vi.fn<PaneDropRegistration["unregister"]>(),
  paneAtPoint: vi.fn(paneAtPoint),
  insertInto: vi.fn<PaneDropRegistration["insertInto"]>(),
});

// Eine einzelne Baumzeile in ihrer für diesen Vorgang wesentlichen Form: sie
// startet das Ziehen beim Drücken und öffnet beim Klicken — dieselbe
// Reihenfolge wie `TreeRow` in ExplorerPanel.tsx.
function Row({
  targets,
  onOpen,
}: {
  targets: PaneDropRegistration;
  onOpen: () => void;
}) {
  const drag = useExplorerPathDrag(targets);
  return (
    <button
      type="button"
      onPointerDown={(event) => {
        drag.startDrag(event, "/Users/dev/projects/app/src/main.rs", "src/main.rs");
      }}
      onClick={() => {
        if (drag.consumeDragClick()) return;
        onOpen();
      }}
    >
      {"main.rs"}
    </button>
  );
}

const setup = (paneAtPoint: (point: { x: number; y: number }) => string | null) => {
  const targets = dropRegistration(paneAtPoint);
  const onOpen = vi.fn();
  render(<Row targets={targets} onOpen={onOpen} />);
  const row = screen.getByRole("button", { name: "main.rs" });
  // jsdom kennt die Pointer-Capture-Methoden nicht — sie sind für diesen Test
  // auch folgenlos, weil `fireEvent` ohnehin direkt auf dem Element zustellt.
  // Attrappen statt eines Verzichts im Produktivcode: im echten Webview ist
  // das Capture die Bedingung dafür, dass der Vorgang das Verlassen des
  // Explorers überlebt (Begründung im Hook).
  row.setPointerCapture = vi.fn();
  row.releasePointerCapture = vi.fn();
  row.hasPointerCapture = vi.fn(() => true);
  return { targets, onOpen, row };
};

describe("useExplorerPathDrag", () => {
  it("öffnet die Datei bei einem Klick mit minimalem Zittern, statt zu ziehen", () => {
    const { targets, onOpen, row } = setup(() => "pane-1");

    fireEvent.pointerDown(row, { button: 0, clientX: 100, clientY: 100 });
    // 2px — unter der Schwelle, das ist ein Klick und kein Ziehen.
    fireEvent.pointerMove(row, { clientX: 102, clientY: 101 });
    fireEvent.pointerUp(row, { clientX: 102, clientY: 101 });
    fireEvent.click(row);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(targets.insertInto).not.toHaveBeenCalled();
  });

  it("liefert den absoluten Pfad an die Pane unter dem Zeiger und schluckt den Klick", () => {
    const { targets, onOpen, row } = setup(() => "pane-2");

    fireEvent.pointerDown(row, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(row, { clientX: 400, clientY: 260 });
    fireEvent.pointerUp(row, { clientX: 400, clientY: 260 });
    // Das Pointer-Capture führt den Klick zur Zeile zurück, auch wenn über
    // der Pane losgelassen wurde — ohne die Unterdrückung öffnete jeder
    // erfolgreiche Drop die Datei nebenbei im Editor.
    fireEvent.click(row);

    expect(targets.insertInto).toHaveBeenCalledWith("pane-2", [
      "/Users/dev/projects/app/src/main.rs",
    ]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("fügt nichts ein, wenn außerhalb jeder Pane losgelassen wird", () => {
    const { targets, onOpen, row } = setup(() => null);

    fireEvent.pointerDown(row, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(row, { clientX: 140, clientY: 300 });
    fireEvent.pointerUp(row, { clientX: 140, clientY: 300 });
    fireEvent.click(row);

    expect(targets.insertInto).not.toHaveBeenCalled();
    // Ein Ziehen ins Leere ist ein Abbruch — es öffnet die Datei auch nicht
    // ersatzweise.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("lässt den nächsten echten Klick zu, nachdem ein Ziehen abgebrochen wurde", () => {
    const { targets, onOpen, row } = setup(() => "pane-1");

    fireEvent.pointerDown(row, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(row, { clientX: 400, clientY: 260 });
    // Abbruch ohne folgenden Klick — z. B. weil das System den Zeiger
    // entzogen hat. Bliebe die Unterdrückungs-Markierung liegen, verschluckte
    // sie den nächsten echten Klick des Nutzers.
    fireEvent.pointerCancel(row, { clientX: 400, clientY: 260 });

    fireEvent.pointerDown(row, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(row, { clientX: 100, clientY: 100 });
    fireEvent.click(row);

    expect(targets.insertInto).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("ignoriert die sekundäre Maustaste", () => {
    const { targets, row } = setup(() => "pane-1");

    fireEvent.pointerDown(row, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(row, { clientX: 400, clientY: 260 });
    fireEvent.pointerUp(row, { clientX: 400, clientY: 260 });

    expect(targets.insertInto).not.toHaveBeenCalled();
  });
});
