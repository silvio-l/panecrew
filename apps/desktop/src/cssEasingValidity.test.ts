// Regressionswache gegen eine stille Totalausfall-Klasse: `steps(1, jump-none)`
// ist per CSS-Easing-Spezifikation ungültig (jump-none verlangt >= 2
// Intervalle), und eine ungültige Timing-Funktion lässt Browser die GESAMTE
// animation-Deklaration beim Parsen fallen — ohne Fehler, ohne Warnung. Genau
// so waren TitleBar-Uhr-Blink und Slot-Cursor-Blink bis 2026-08-13 komplett
// tot (WebKit wie Blink, nachgemessen via CSS.supports und computedStyle).
//
// Der eigentlich richtige Test-Seam wäre ein echter Browser (computedStyle
// animationName !== "none") — den gibt es in diesem Repo nicht (kein
// Playwright, und jsdom validiert Easing-Funktionen nicht). Diese Quelltext-
// Prüfung ist der nächstbeste Riegel: sie fängt exakt das Wiederauftreten
// dieses Musters, nicht die ganze Fehlerklasse. import.meta.glob statt
// node:fs, weil der src-tsconfig bewusst rein browserseitig bleibt.
import { describe, expect, it } from "vitest";

const stylesheets: Record<string, string> = import.meta.glob("./**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("CSS easing validity", () => {
  it("no stylesheet uses the spec-invalid steps(1, jump-none)", () => {
    expect(Object.keys(stylesheets).length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const [file, css] of Object.entries(stylesheets)) {
      // Nur echte Deklarationen zählen, keine Kommentare, die das Muster
      // (wie in App.css) als Warnung erwähnen.
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
      if (/steps\(\s*1\s*,\s*jump-none\s*\)/.test(withoutComments)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
