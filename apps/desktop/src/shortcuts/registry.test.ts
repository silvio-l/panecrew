import { describe, expect, it } from "vitest";
import { formatChord, matchesShortcut, SHORTCUTS } from "./registry";
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
