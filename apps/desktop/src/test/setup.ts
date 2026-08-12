import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library hängt sein automatisches cleanup nur ein, wenn Vitest mit
// `globals: true` läuft — tut es hier nicht. Ohne diesen Aufruf bliebe das DOM
// des vorherigen Tests stehen und Abfragen fänden Elemente doppelt.
afterEach(cleanup);

// jsdom kennt keinen ResizeObserver; die Terminal-Pane observiert damit ihren
// Container, um den FitAddon zu triggern. Ein No-Op-Stub reicht — die
// Größenlogik selbst lebt in xterm.js und ist in jsdom ohnehin nicht messbar.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

// Unbedingt gesetzt: in jsdom gibt es keine echte Implementierung, die hier
// überschrieben werden könnte.
globalThis.ResizeObserver = ResizeObserverStub;

// jsdom rechnet kein Layout: jedes Element meldet `offsetHeight` 0. Für die
// virtualisierte Explorer-Liste (ExplorerPanel.tsx) ist das nicht bloß ungenau,
// sondern der Aus-Zustand — ein Sichtfenster der Höhe 0 enthält keine sichtbare
// Zeile, der Virtualizer mountet dann folgerichtig gar keine (er setzt seinen
// Bereich bei Außengröße 0 auf `null`), und jeder Test, der eine Baumzeile
// sucht, stünde vor einem leeren Panel.
//
// Deshalb bekommt genau das eine Element eine Höhe untergeschoben, an dem der
// Virtualizer sein Sichtfenster misst: der Scroll-Container des Baums,
// erkennbar an `data-virtual-viewport`. Bewusst nur `offsetWidth/-Height` und
// nicht `getBoundingClientRect` — Letzteres ist der Messweg der Pane-Zuordnung
// beim Dateiablegen (dropRouting.ts), und die verlässt sich ausdrücklich
// darauf, dass jsdom dort Nullrechtecke liefert.
//
// Die Zahl ist frei gewählt und bedeutet nur „ein paar Bildschirmzeilen hoch":
// 400px sind bei 22px Zeilenhöhe rund 18 sichtbare Zeilen. Ein Test, der auf
// eine bestimmte Zeilenzahl hinauswill, muss diese Rechnung mitführen.
const TEST_VIEWPORT_HEIGHT = 400;
const TEST_VIEWPORT_WIDTH = 224;
const isVirtualViewport = (element: HTMLElement) =>
  "virtualViewport" in element.dataset;

Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    configurable: true,
    get(this: HTMLElement) {
      return isVirtualViewport(this) ? TEST_VIEWPORT_HEIGHT : 0;
    },
  },
  offsetWidth: {
    configurable: true,
    get(this: HTMLElement) {
      return isVirtualViewport(this) ? TEST_VIEWPORT_WIDTH : 0;
    },
  },
});
