import { describe, expect, it } from "vitest";
import { formatChord, matchesShortcut, SHORTCUTS, zoomAction } from "./registry";
import type { ShortcutDefinition, ShortcutKeyEvent } from "./registry";

const baseEvent: ShortcutKeyEvent = {
  code: "Equal",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
};

function shortcut(id: string): ShortcutDefinition {
  const found = SHORTCUTS.find((s) => s.id === id);
  if (!found) throw new Error(`Unbekannte Shortcut-Id im Test: ${id}`);
  return found;
}

const appZoomIn = shortcut("app.zoomIn");
const paneZoomIn = shortcut("pane.zoomIn");
const appZoomOut = shortcut("app.zoomOut");
const paneZoomOut = shortcut("pane.zoomOut");

describe("matchesShortcut", () => {
  it("erkennt Cmd+Shift+Plus auf dem Mac als App-weiten Zoom (US-Tastenposition)", () => {
    const event = { ...baseEvent, code: "Equal", shiftKey: true, metaKey: true };
    expect(matchesShortcut(event, appZoomIn, true)).toBe(true);
  });

  it("erkennt dieselbe Kombination auch über die deutsche Tastenposition", () => {
    // Deutsche ISO-Tastatur: "+"/"*" sitzt auf einer eigenen Taste
    // (Code "BracketRight"), nicht auf der US-Position "Equal" — die
    // Erkennung darf nicht davon abhängen, welches Zeichen Shift daraus
    // macht ("*" statt "+"), nur von Taste + Modifikatoren.
    const event = {
      ...baseEvent,
      code: "BracketRight",
      shiftKey: true,
      metaKey: true,
    };
    expect(matchesShortcut(event, appZoomIn, true)).toBe(true);
  });

  it("erkennt Cmd+Shift+Minus auf der US-Tastenposition", () => {
    const event = { ...baseEvent, code: "Minus", shiftKey: true, metaKey: true };
    expect(matchesShortcut(event, appZoomOut, true)).toBe(true);
  });

  it("erkennt Minus auch über die deutsche Tastenposition (\"Slash\")", () => {
    // Deutsche Tastatur: "-" sitzt NICHT in der Ziffernreihe (dort liegt
    // "ß", Code "Minus"), sondern zwischen "." und der rechten Umschalttaste
    // — derselben Position, die eine US-Tastatur für "/" nutzt (Code
    // "Slash"). Das war der gemeldete Fehler: Plus funktionierte über
    // "BracketRight", Minus fehlte die entsprechende deutsche Position noch.
    const event = {
      ...baseEvent,
      code: "Slash",
      shiftKey: false,
      metaKey: true,
    };
    expect(matchesShortcut(event, paneZoomOut, true)).toBe(true);
  });

  it("unterscheidet App-weiten Zoom vom Pane-Zoom über die Shift-Taste", () => {
    const withShift = { ...baseEvent, code: "Equal", shiftKey: true, metaKey: true };
    const withoutShift = { ...baseEvent, code: "Equal", shiftKey: false, metaKey: true };
    expect(matchesShortcut(withShift, appZoomIn, true)).toBe(true);
    expect(matchesShortcut(withShift, paneZoomIn, true)).toBe(false);
    expect(matchesShortcut(withoutShift, paneZoomIn, true)).toBe(true);
    expect(matchesShortcut(withoutShift, appZoomIn, true)).toBe(false);
  });

  it("verlangt auf Windows/Linux Strg statt Cmd als Primärmodifikator", () => {
    const withCtrl = { ...baseEvent, code: "Equal", shiftKey: true, ctrlKey: true };
    const withMeta = { ...baseEvent, code: "Equal", shiftKey: true, metaKey: true };
    expect(matchesShortcut(withCtrl, appZoomIn, false)).toBe(true);
    expect(matchesShortcut(withMeta, appZoomIn, false)).toBe(false);
  });

  it("lehnt ab, wenn zusätzlich der jeweils andere Modifikator gedrückt ist", () => {
    const event = {
      ...baseEvent,
      code: "Equal",
      shiftKey: true,
      metaKey: true,
      ctrlKey: true,
    };
    expect(matchesShortcut(event, appZoomIn, true)).toBe(false);
  });

  it("lehnt eine fremde Tastenposition ab", () => {
    const event = { ...baseEvent, code: "KeyA", shiftKey: true, metaKey: true };
    expect(matchesShortcut(event, appZoomIn, true)).toBe(false);
  });

  it("erkennt Cmd+N als Neues-Fenster-Kürzel", () => {
    const newWindow = shortcut("app.newWindow");
    const event = { ...baseEvent, code: "KeyN", shiftKey: false, metaKey: true };
    expect(matchesShortcut(event, newWindow, true)).toBe(true);
  });

  it("erkennt Cmd+W auf dem Mac und Strg+W auf Windows/Linux als Terminal-Tab-Schließen-Kürzel", () => {
    const closeTab = shortcut("pane.closeTerminalTab");
    const macEvent = { ...baseEvent, code: "KeyW", shiftKey: false, metaKey: true };
    const otherEvent = { ...baseEvent, code: "KeyW", shiftKey: false, ctrlKey: true };
    expect(matchesShortcut(macEvent, closeTab, true)).toBe(true);
    expect(matchesShortcut(otherEvent, closeTab, false)).toBe(true);
  });
});

describe("zoomAction", () => {
  it("deutet das Neues-Fenster-Kürzel nicht als Zoom-Aktion", () => {
    // Regressionstest für den Bug, den useAppZoom.ts's zoomAction-Filter
    // verhindert: ohne ihn würde "N" (weder "+" noch "0") als "-" gelesen.
    expect(zoomAction(shortcut("app.newWindow"))).toBeNull();
  });
});

describe("formatChord", () => {
  it("stellt den App-Zoom auf dem Mac mit Symbolen dar", () => {
    expect(formatChord(appZoomIn, "mac")).toBe("⇧⌘+");
  });

  it("stellt den Pane-Zoom auf dem Mac ohne Shift-Symbol dar", () => {
    expect(formatChord(paneZoomIn, "mac")).toBe("⌘+");
  });

  it("stellt beide auf Windows/Linux textuell dar", () => {
    expect(formatChord(appZoomIn, "other")).toBe("Ctrl+Shift++");
    expect(formatChord(paneZoomIn, "other")).toBe("Ctrl++");
  });
});
