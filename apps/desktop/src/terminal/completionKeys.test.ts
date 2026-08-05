import { describe, expect, it, vi } from "vitest";
import { routeCompletionKey } from "./completionKeys";

// Der gemeldete Fehler hing genau an diesen Entscheidungen, und zwar an der
// Richtung, die leicht übersehen wird: was passiert, wenn NICHTS sichtbar ist.
// Eine Taste, die hier fälschlich genommen wird, verschwindet; eine, die
// fälschlich durchfällt, richtet in der Shell etwas an (ein einzelnes Escape
// wird dort zum Meta-Präfix und macht aus dem nächsten Enter ein wörtliches CR
// in der Eingabezeile, statt sie abzuschicken).

const key = (init: Partial<KeyboardEvent> & { key: string }) => ({
  key: init.key,
  ctrlKey: init.ctrlKey ?? false,
  metaKey: init.metaKey ?? false,
  altKey: init.altKey ?? false,
  shiftKey: init.shiftKey ?? false,
  preventDefault: vi.fn(),
});

function completion({
  visible = false,
  accepts = true,
  ghost = false,
}: { visible?: boolean; accepts?: boolean; ghost?: boolean } = {}) {
  return {
    accept: vi.fn(() => ghost),
    directories: {
      visible: () => visible,
      move: vi.fn(),
      accept: vi.fn(() => accepts),
      dismiss: vi.fn(),
    },
  };
}

describe("routeCompletionKey bei sichtbarem Popup", () => {
  it("bewegt die Auswahl mit den Pfeiltasten", () => {
    const suggestion = completion({ visible: true });

    expect(routeCompletionKey(key({ key: "ArrowDown" }), suggestion)).toBe(true);
    expect(routeCompletionKey(key({ key: "ArrowUp" }), suggestion)).toBe(true);
    expect(suggestion.directories.move.mock.calls).toEqual([[1], [-1]]);
  });

  it("übernimmt mit Enter und Tab und hält den Webview davon ab mitzureagieren", () => {
    const suggestion = completion({ visible: true });
    const tab = key({ key: "Tab" });

    expect(routeCompletionKey(tab, suggestion)).toBe(true);
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(routeCompletionKey(key({ key: "Enter" }), suggestion)).toBe(true);
  });

  it("gibt Enter an die Shell, wenn es doch nichts zu übernehmen gibt", () => {
    const suggestion = completion({ visible: true, accepts: false });

    expect(routeCompletionKey(key({ key: "Enter" }), suggestion)).toBe(false);
  });

  it("schluckt Escape — genau dafür ist es da", () => {
    const suggestion = completion({ visible: true });

    expect(routeCompletionKey(key({ key: "Escape" }), suggestion)).toBe(true);
    expect(suggestion.directories.dismiss).toHaveBeenCalled();
  });

  it("lässt alles mit Modifikator in Ruhe", () => {
    const suggestion = completion({ visible: true });

    // Shift+Enter ist der weiche Zeilenumbruch der Pane, Cmd+Enter gehört
    // dem laufenden Programm — beides darf die Liste nicht abfangen.
    expect(
      routeCompletionKey(key({ key: "Enter", shiftKey: true }), suggestion),
    ).toBe(false);
    expect(
      routeCompletionKey(key({ key: "ArrowUp", altKey: true }), suggestion),
    ).toBe(false);
    expect(suggestion.directories.accept).not.toHaveBeenCalled();
  });
});

describe("routeCompletionKey ohne sichtbares Popup", () => {
  it("gibt alle fünf Tasten unverändert an die Shell", () => {
    const suggestion = completion();

    for (const name of ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]) {
      expect(routeCompletionKey(key({ key: name }), suggestion)).toBe(false);
    }
    expect(suggestion.directories.move).not.toHaveBeenCalled();
    expect(suggestion.directories.accept).not.toHaveBeenCalled();
    expect(suggestion.directories.dismiss).not.toHaveBeenCalled();
  });

  it("übernimmt den Geistertext mit Pfeil rechts und Ctrl+F", () => {
    const suggestion = completion({ ghost: true });

    expect(routeCompletionKey(key({ key: "ArrowRight" }), suggestion)).toBe(true);
    expect(
      routeCompletionKey(key({ key: "f", ctrlKey: true }), suggestion),
    ).toBe(true);
  });

  it("lässt Pfeil rechts und Ctrl+F durch, wenn kein Geistertext steht", () => {
    const suggestion = completion({ ghost: false });

    expect(routeCompletionKey(key({ key: "ArrowRight" }), suggestion)).toBe(
      false,
    );
    expect(
      routeCompletionKey(key({ key: "f", ctrlKey: true }), suggestion),
    ).toBe(false);
  });
});

describe("routeCompletionKey mit sichtbarem Popup UND Geistertext", () => {
  it("lässt Pfeil rechts weiterhin den Geistertext übernehmen", () => {
    // Beide dürfen gleichzeitig stehen. Die Liste beansprucht nur ihre fünf
    // Tasten; dass sie offen ist, darf Pfeil rechts nicht die Bedeutung
    // nehmen, die es in jeder anderen Zeile hat.
    const suggestion = completion({ visible: true, ghost: true });

    expect(routeCompletionKey(key({ key: "ArrowRight" }), suggestion)).toBe(
      true,
    );
    expect(suggestion.accept).toHaveBeenCalled();
  });
});
