import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusTrace } from "./FocusTrace";

// jsdom rechnet kein Layout — getBoundingClientRect liefert überall Nullen.
// Die Routen-MATHEMATIK ist deshalb vollständig in traceGeometry.test.ts
// abgedeckt; hier steht die Verdrahtung: dass die Komponente Pin, Pane und
// Grid-Kante über ihre data-Attribute findet, die Messwerte in Pfad + Pad
// übersetzt und ohne auffindbare Gegenstücke nichts zeichnet. Die Rechtecke
// werden dafür pro Fixture-Element gestellt (dasselbe Vorgehen wie die
// paneAtPoint-Tests rund um useWebviewFileDrop).

const domRect = (
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

/** Pin + Workspace + Pane als eigenes Render VOR dem FocusTrace-Mount — die
 * Rechteck-Attrappen müssen stehen, bevor dessen Mess-Effekt läuft. */
function mountFixture() {
  const { container } = render(
    <div>
      {/* Reines Mess-Fixture — gegriffen wird es unten über sein
          data-Attribut, ein accessible name ist hier nicht Testgegenstand. */}
      <button type="button" data-pin-pane-id="pane-1" />
      <div className="pc-workspace">
        <section data-pane-id="pane-1" />
      </div>
    </div>,
  );
  const pin = container.querySelector("[data-pin-pane-id]") as HTMLElement;
  const workspace = container.querySelector(".pc-workspace") as HTMLElement;
  const pane = container.querySelector("[data-pane-id]") as HTMLElement;
  pin.getBoundingClientRect = () => domRect(0, 92, 16, 16); // Mitte (8, 100)
  workspace.getBoundingClientRect = () => domRect(20, 30, 500, 400);
  pane.getBoundingClientRect = () => domRect(28, 40, 400, 300);
  return { pin, workspace, pane };
}

describe("FocusTrace", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("zeichnet die gefaste Route vom Pin zum Pad auf der Pane-Oberkante", () => {
    mountFixture();
    const { container } = render(
      <FocusTrace
        focusedPaneId="pane-1"
        template="quad"
        slots={[]}
        maximizedPaneId={null}
      />,
    );

    const path = container.querySelector("path");
    // Route (traceGeometry): Pin (8,100) → Bus-Kanal x=16 → Quer-Kanal y=36
    // → Pad-Spalte x=52 → Oberkante y=40, mit 45°-Fasen (am kurzen ersten
    // Segment auf dessen halbe Länge geklemmt).
    expect(path?.getAttribute("d")).toBe(
      "M 8 100 L 12 100 L 16 96 L 16 42 L 22 36 L 50 36 L 52 38 L 52 40",
    );

    const pad = container.querySelector("rect");
    expect(pad?.getAttribute("display")).toBeNull();
    expect(pad?.getAttribute("x")).toBe("48");
    // Ganz oberhalb der Oberkante (y=40 - Pad-Höhe 4), nicht mittig auf ihr
    // — mittig verschwand der Pad optisch fast vollständig in der Border
    // (Kopfkommentar FocusTrace.tsx, an der Stelle des Fixes).
    expect(pad?.getAttribute("y")).toBe("36");
  });

  it("zeichnet nichts, solange Pin oder Pane nicht auffindbar sind", () => {
    const { container } = render(
      <FocusTrace
        focusedPaneId="pane-unbekannt"
        template="quad"
        slots={[]}
        maximizedPaneId={null}
      />,
    );

    expect(container.querySelector("path")?.getAttribute("d")).toBeNull();
    expect(container.querySelector("rect")?.getAttribute("display")).toBe("none");
  });

  it("zeichnet nichts ohne fokussierte Pane", () => {
    mountFixture();
    const { container } = render(
      <FocusTrace
        focusedPaneId={null}
        template="quad"
        slots={[]}
        maximizedPaneId={null}
      />,
    );

    expect(container.querySelector("path")?.getAttribute("d")).toBeNull();
  });

  // Regressionstest zum Befund „Leiterbahn läuft durch den Pane-Header"
  // (2026-08-14): draw() hatte nach der 320ms-settle-Frist nur noch EINEN
  // ResizeObserver auf einem konkreten DOM-Knoten als Korrektiv. Verschiebt
  // sich die Pane ohne Größenänderung (größengleicher Slot-Tausch, dessen
  // FLIP die settle-Messung verpasst) oder wird der beobachtete Knoten
  // ersetzt (React-Remount/HMR in der Dev-Instanz), blieb die Leitung
  // dauerhaft auf der veralteten Geometrie stehen. Der Selbstkorrektur-Takt
  // misst jetzt periodisch nach — jsdom hat keinen ResizeObserver, der Takt
  // ist hier also nachweislich der einzige Korrekturweg.
  it("korrigiert eine veraltete Route auch ohne Resize- oder State-Signal", () => {
    vi.useFakeTimers();
    const { pane } = mountFixture();
    const { container } = render(
      <FocusTrace
        focusedPaneId="pane-1"
        template="quad"
        slots={[]}
        maximizedPaneId={null}
      />,
    );
    // settle-Frist verstreichen lassen — danach gab es im alten Code keinen
    // weiteren Zeichenanlass mehr.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Positionswechsel OHNE Größenänderung, ohne gridState-Änderung:
    pane.getBoundingClientRect = () => domRect(228, 40, 400, 300);
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    const path = container.querySelector("path");
    expect(path?.getAttribute("d")).toBe(
      "M 8 100 L 12 100 L 16 96 L 16 42 L 22 36 L 250 36 L 252 38 L 252 40",
    );
  });

  // Kehrseite desselben Fixes: der Takt (und jeder andere stille Nachzieh-
  // Anlass) darf bei UNVERÄNDERTER Geometrie nichts neu schreiben — sonst
  // würde er u. a. eine gerade laufende Aufbau-Animation grundlos abbrechen.
  it("schreibt bei unveränderter Geometrie keine neuen Attribute", () => {
    vi.useFakeTimers();
    mountFixture();
    const { container } = render(
      <FocusTrace
        focusedPaneId="pane-1"
        template="quad"
        slots={[]}
        maximizedPaneId={null}
      />,
    );
    const path = container.querySelector("path") as SVGPathElement;
    const writes: string[] = [];
    const original = path.setAttribute.bind(path);
    path.setAttribute = (name: string, value: string) => {
      writes.push(name);
      original(name, value);
    };

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(writes.filter((name) => name === "d")).toEqual([]);
  });

  it("bleibt für Screenreader unsichtbar und fängt keine Zeigereingaben", () => {
    const { container } = render(
      <FocusTrace
        focusedPaneId={null}
        template="quad"
        slots={[]}
        maximizedPaneId={null}
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.getAttribute("class")).toContain("pointer-events-none");
  });
});
