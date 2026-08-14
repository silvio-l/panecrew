// Prüfschleife für die FLIP-Übergänge des Grids (useGridTransitions.ts):
// jsdom hat weder WAAPI noch Layout, deshalb werden hier `Element.animate`
// gestubbt und die Zellrechtecke pro Schlüssel untergeschoben — geprüft wird
// die ENTSCHEIDUNG des Hooks (wer animiert wann womit), nicht die Optik.
//
// Die eigentliche PTY-Unmount-Garantie (Template-Wechsel mountet nie eine
// Zelle neu) deckt App.test.tsx ab ("kompaktiert beim erlaubten Schrumpfen …
// ohne Kill oder Spawn"); hier steht die zweite Hälfte des Vertrags: der Hook
// erzeugt/entfernt selbst nichts, er ruft ausschließlich `animate` auf den
// bestehenden Zellen auf.
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateId } from "./gridState";
import { useGridTransitions } from "./useGridTransitions";

interface AnimateCall {
  key: string;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

const animateCalls: AnimateCall[] = [];

// Rechteck pro Zellschlüssel — der getBoundingClientRect-Stub unten liest
// hier nach. `hidden` steuert der Harness über den echten Inline-Style.
const rects = new Map<string, { x: number; y: number; w: number; h: number }>();

// Zählt jeden `getBoundingClientRect()`-Aufruf — die einzige Möglichkeit, den
// Ticket-09-Vertrag ("kein Layout-Read ohne Trigger-Wechsel") direkt zu
// prüfen, statt ihn nur indirekt über ausbleibende `animate`-Aufrufe zu
// erschließen.
let rectReadCount = 0;

function fakeAnimation(): Animation {
  return {
    cancel: () => undefined,
    addEventListener: () => undefined,
  } as unknown as Animation;
}

beforeEach(() => {
  animateCalls.length = 0;
  rects.clear();
  rectReadCount = 0;
  HTMLElement.prototype.animate = function (
    this: HTMLElement,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    animateCalls.push({
      key: this.dataset.cellkey ?? "?",
      keyframes: keyframes as Keyframe[],
      options: options as KeyframeAnimationOptions,
    });
    return fakeAnimation();
  };
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    rectReadCount += 1;
    const r = rects.get(this.dataset.cellkey ?? "") ?? { x: 0, y: 0, w: 0, h: 0 };
    return {
      x: r.x,
      y: r.y,
      left: r.x,
      top: r.y,
      right: r.x + r.w,
      bottom: r.y + r.h,
      width: r.w,
      height: r.h,
      toJSON: () => ({}),
    };
  };
});

afterEach(() => {
  // @ts-expect-error — jsdom hat kein eigenes `animate`, zurück in den
  // Ursprungszustand (undefined), damit andere Tests den No-Op-Pfad sehen.
  delete HTMLElement.prototype.animate;
  // getBoundingClientRect gehört jsdom selbst — Prototyp-Delete stellt die
  // ererbte Element-Implementierung wieder her.
  // @ts-expect-error — delete auf nicht-optionaler DOM-Eigenschaft, s. o.
  delete HTMLElement.prototype.getBoundingClientRect;
  vi.restoreAllMocks();
});

function Harness({
  cells,
  template,
  maximized,
}: {
  cells: readonly { key: string; hidden?: boolean }[];
  template: TemplateId;
  maximized: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useGridTransitions(
    ref,
    cells.map((cell) => cell.key),
    template,
    maximized,
  );
  return (
    <div ref={ref}>
      {cells.map((cell) => (
        <div
          key={cell.key}
          data-cellkey={cell.key}
          style={cell.hidden ? { visibility: "hidden" } : undefined}
        />
      ))}
    </div>
  );
}

describe("useGridTransitions", () => {
  it("spielt beim Template-Wechsel einen FLIP-Transform von altem zu neuem Rechteck", () => {
    rects.set("a", { x: 0, y: 0, w: 100, h: 100 });
    rects.set("b", { x: 110, y: 0, w: 100, h: 100 });
    const { rerender } = render(
      <Harness
        cells={[{ key: "a" }, { key: "b" }]}
        template="split"
        maximized={null}
      />,
    );
    expect(animateCalls).toHaveLength(0);

    // Geteilt→Übereinander (fiktive Geometrie): b rutscht unter a.
    rects.set("a", { x: 0, y: 0, w: 210, h: 45 });
    rects.set("b", { x: 0, y: 55, w: 210, h: 45 });
    rerender(
      <Harness
        cells={[{ key: "a" }, { key: "b" }]}
        template="quad"
        maximized={null}
      />,
    );

    expect(animateCalls.map((call) => call.key)).toEqual(["a", "b"]);
    const b = animateCalls[1] as AnimateCall;
    // First-Rechteck minus Last-Rechteck: dx=110-0, dy=0-55, sx=100/210, sy=100/45.
    expect(b.keyframes[0]?.transform).toBe(
      `translate(110px, -55px) scale(${100 / 210}, ${100 / 45})`,
    );
    expect(b.keyframes[1]?.transform).toBe("translate(0px, 0px) scale(1, 1)");
  });

  it("FLIPpt beide Panes beim reinen Slot-Tausch (Ticket 20) — ohne Template-/Fokus-Wechsel", () => {
    rects.set("a", { x: 0, y: 0, w: 100, h: 100 });
    rects.set("b", { x: 110, y: 0, w: 100, h: 100 });
    const { rerender } = render(
      <Harness
        cells={[{ key: "a" }, { key: "b" }]}
        template="split"
        maximized={null}
      />,
    );

    // Getauschte Slots: gleiche Geometrie, vertauschte Schlüsselreihenfolge —
    // die DOM-Reihenfolge IST die Slot-Reihenfolge, `cellKeys[i]` gehört zu
    // `children[i]`, also trägt jetzt die erste Zelle "b".
    rects.set("a", { x: 110, y: 0, w: 100, h: 100 });
    rects.set("b", { x: 0, y: 0, w: 100, h: 100 });
    rerender(
      <Harness
        cells={[{ key: "b" }, { key: "a" }]}
        template="split"
        maximized={null}
      />,
    );

    const a = animateCalls.find((call) => call.key === "a");
    const b = animateCalls.find((call) => call.key === "b");
    expect(a?.keyframes[0]?.transform).toBe(
      "translate(-110px, 0px) scale(1, 1)",
    );
    expect(b?.keyframes[0]?.transform).toBe("translate(110px, 0px) scale(1, 1)");
  });

  it("animiert NICHT bei einem Re-Render ohne Template-/Fokus-Modus-Wechsel", () => {
    rects.set("a", { x: 0, y: 0, w: 100, h: 100 });
    const { rerender } = render(
      <Harness cells={[{ key: "a" }]} template="single" maximized={null} />,
    );
    // Anderes Rechteck (z. B. nach Fenster-Resize), aber gleicher Trigger.
    rects.set("a", { x: 0, y: 0, w: 300, h: 300 });
    rerender(
      <Harness cells={[{ key: "a" }]} template="single" maximized={null} />,
    );
    expect(animateCalls).toHaveLength(0);
  });

  it("überspringt frisch gemountete Zellen (deren Auftritt gehört pc-cell-in)", () => {
    rects.set("a", { x: 0, y: 0, w: 100, h: 100 });
    const { rerender } = render(
      <Harness cells={[{ key: "a" }]} template="single" maximized={null} />,
    );
    rects.set("a", { x: 0, y: 0, w: 100, h: 100 });
    rects.set("neu", { x: 110, y: 0, w: 100, h: 100 });
    rerender(
      <Harness
        cells={[{ key: "a" }, { key: "neu" }]}
        template="split"
        maximized={null}
      />,
    );
    expect(animateCalls.map((call) => call.key)).not.toContain("neu");
  });

  it("blendet die Nachbarzellen beim Fokus-Modus-Eintritt aus — mit visibility-Override, solange die Animation läuft", () => {
    rects.set("max", { x: 0, y: 0, w: 100, h: 100 });
    rects.set("nachbar", { x: 110, y: 0, w: 100, h: 100 });
    const { rerender } = render(
      <Harness
        cells={[{ key: "max" }, { key: "nachbar" }]}
        template="split"
        maximized={null}
      />,
    );
    rects.set("max", { x: 0, y: 0, w: 210, h: 100 });
    rerender(
      <Harness
        cells={[{ key: "max" }, { key: "nachbar", hidden: true }]}
        template="split"
        maximized="max"
      />,
    );

    const nachbar = animateCalls.find((call) => call.key === "nachbar");
    expect(nachbar?.keyframes).toEqual([
      { opacity: 1, visibility: "visible" },
      { opacity: 0, visibility: "visible" },
    ]);
    // Die maximierte Zelle selbst FLIPpt auf ihr neues, volles Rechteck.
    const max = animateCalls.find((call) => call.key === "max");
    expect(max?.keyframes[0]?.transform).toContain("scale(");
  });

  it("blendet sie beim Austritt wieder ein und schrumpft die maximierte Zelle zurück", () => {
    rects.set("max", { x: 0, y: 0, w: 210, h: 100 });
    rects.set("nachbar", { x: 110, y: 0, w: 100, h: 100 });
    const { rerender } = render(
      <Harness
        cells={[{ key: "max" }, { key: "nachbar", hidden: true }]}
        template="split"
        maximized="max"
      />,
    );
    rects.set("max", { x: 0, y: 0, w: 100, h: 100 });
    rerender(
      <Harness
        cells={[{ key: "max" }, { key: "nachbar" }]}
        template="split"
        maximized={null}
      />,
    );

    expect(
      animateCalls.find((call) => call.key === "nachbar")?.keyframes,
    ).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(
      animateCalls.find((call) => call.key === "max")?.keyframes[0]?.transform,
    ).toBe(`translate(0px, 0px) scale(${210 / 100}, 1)`);
  });

  it("respektiert prefers-reduced-motion: reduce vollständig", () => {
    window.matchMedia = ((query: string) =>
      ({
        matches: query === "(prefers-reduced-motion: reduce)",
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList);

    rects.set("a", { x: 0, y: 0, w: 100, h: 100 });
    const { rerender } = render(
      <Harness cells={[{ key: "a" }]} template="single" maximized={null} />,
    );
    rects.set("a", { x: 0, y: 0, w: 50, h: 50 });
    rerender(
      <Harness cells={[{ key: "a" }]} template="split" maximized={null} />,
    );

    expect(animateCalls).toHaveLength(0);

    // @ts-expect-error — jsdom bringt kein matchMedia mit, zurück zu undefined.
    delete window.matchMedia;
  });

  it("liest getBoundingClientRect nicht bei unverändertem Trigger, aber bei einer echten Änderung (Ticket 09)", () => {
    rects.set("a", { x: 0, y: 0, w: 100, h: 100 });
    const { rerender } = render(
      <Harness cells={[{ key: "a" }]} template="single" maximized={null} />,
    );
    const afterMount = rectReadCount;
    expect(afterMount).toBeGreaterThan(0);

    // Gleicher Trigger, aber ein anderes Rechteck — genau der Fall, den der
    // Hook früher trotzdem vermessen hat (Layout-Drift durch z. B. eine
    // Fenster- oder Explorer-Größenänderung, hier direkt untergeschoben statt
    // über einen echten Resize simuliert). Kein Trigger-Wechsel → kein Read.
    rects.set("a", { x: 0, y: 0, w: 300, h: 300 });
    rerender(
      <Harness cells={[{ key: "a" }]} template="single" maximized={null} />,
    );
    expect(rectReadCount).toBe(afterMount);
    expect(animateCalls).toHaveLength(0);

    // Echter Trigger-Wechsel (Template) — jetzt wird wieder gemessen.
    rerender(
      <Harness cells={[{ key: "a" }]} template="split" maximized={null} />,
    );
    expect(rectReadCount).toBeGreaterThan(afterMount);
  });

  it("frischt die Schnappschüsse über einen ResizeObserver auf, auch ohne Trigger-Wechsel (z. B. Explorer ein-/ausklappen)", () => {
    // jsdom kennt keinen ResizeObserver — dieser Test stubbt gezielt einen,
    // der den Callback festhält, damit er wie eine echte Größenänderung der
    // Werkbank ausgelöst werden kann, ohne einen React-Commit zu brauchen
    // (genau das ist der Kanal: Explorer-Resize läuft zwar über React-State,
    // aber der Hook selbst darf sich bei unverändertem Trigger nicht mehr
    // messen — das Auffrischen muss also von außerhalb des Renders kommen).
    class FakeResizeObserver {
      static instances: FakeResizeObserver[] = [];
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        FakeResizeObserver.instances.push(this);
      }
      observe = (): void => undefined;
      unobserve = (): void => undefined;
      disconnect = (): void => undefined;
    }
    window.ResizeObserver = FakeResizeObserver;

    rects.set("a", { x: 0, y: 0, w: 100, h: 100 });
    rects.set("b", { x: 110, y: 0, w: 100, h: 100 });
    const { rerender } = render(
      <Harness
        cells={[{ key: "a" }, { key: "b" }]}
        template="split"
        maximized={null}
      />,
    );

    // Layout-Drift ohne Trigger-Wechsel — der ResizeObserver-Callback feuert,
    // wie er es bei einer echten Größenänderung der Werkbank täte.
    rects.set("a", { x: 0, y: 0, w: 300, h: 100 });
    rects.set("b", { x: 310, y: 0, w: 100, h: 100 });
    FakeResizeObserver.instances.forEach((observer) =>
      observer.callback([], observer),
    );

    // Jetzt ein echter Trigger-Wechsel: der FLIP MUSS von den soeben
    // aufgefrischten Rechtecken ausgehen (b bei x=310), nicht vom veralteten
    // Mount-Rechteck (x=110) — sonst springt die Zelle beim Animationsstart
    // sichtbar auf einen Stand, der so nie zu sehen war.
    rects.set("a", { x: 0, y: 0, w: 210, h: 45 });
    rects.set("b", { x: 0, y: 55, w: 210, h: 45 });
    rerender(
      <Harness
        cells={[{ key: "a" }, { key: "b" }]}
        template="quad"
        maximized={null}
      />,
    );

    const b = animateCalls.find((call) => call.key === "b");
    expect(b?.keyframes[0]?.transform).toBe(
      `translate(310px, -55px) scale(${100 / 210}, ${100 / 45})`,
    );

    // Aufräumen, damit andere Tests wieder den echten jsdom-Zustand (kein
    // ResizeObserver) sehen — wie beim matchMedia-Stub oben ist die
    // Eigenschaft in den DOM-Typen nicht optional, `delete` braucht daher
    // dieselbe Unterdrückung.
    // @ts-expect-error — jsdom hat keinen ResizeObserver, zurück zu undefined.
    delete window.ResizeObserver;
  });
});
