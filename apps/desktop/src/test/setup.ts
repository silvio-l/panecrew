import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "./jsdomStorageFix";
import { setLanguage } from "../i18n";

// `@tauri-apps/plugin-log`'s functions reach for the real Tauri IPC bridge
// (`window.__TAURI_INTERNALS__`) synchronously, which doesn't exist under
// jsdom — unmocked, any `debug()`/`info()`/`warn()`/`error()` call throws
// past its own `void` call site instead of just rejecting. One global mock
// here instead of per-test-file, since `src/logging/log.ts` is called from
// ordinary app code paths (e.g. `PaneTabs.tsx`), not something each test
// file exercising them would think to mock itself.
vi.mock("@tauri-apps/plugin-log", () => ({
  debug: vi.fn(() => Promise.resolve()),
  info: vi.fn(() => Promise.resolve()),
  warn: vi.fn(() => Promise.resolve()),
  error: vi.fn(() => Promise.resolve()),
}));

// Dieselbe Begründung wie beim `plugin-log`-Mock oben: `usePtyTerminal.ts`
// ruft `getCurrentWindow()`/`listen()` unbedingt bei jedem Pane-Mount auf
// (Cross-Monitor-DPR-Fix), nicht nur etwas, das ein einzelner Testfall
// gezielt anstößt. Ohne Bridge (`window.__TAURI_INTERNALS__`) existiert unter
// jsdom nicht, `getCurrentWindow()` wirft sonst synchron. Ein Testfile mit
// eigenem, reichhaltigerem Mock derselben Module (z. B. App.test.tsx, das
// `listen`-Aufrufe selbst inspiziert) überschreibt diesen Default wie üblich.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ label: "test-window" })),
}));

// Die Test-Suite selbst ist auf deutsche UI-Strings geschrieben (jede
// Assertion erwartet z. B. "Kopiert", nicht "Copied") — unabhängig davon,
// welche Sprache die App für einen frisch installierten Nutzer als DEFAULT
// wählt (`i18n/index.ts`s `initialLanguage()`, seit 2026-08-16 Englisch).
// Diese Entkopplung fixiert die Testsprache explizit auf Deutsch, statt sich
// auf den App-Default zu verlassen.
setLanguage("de");

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

// jsdom implementiert `HTMLCanvasElement.getContext()` nicht (xterm.js'
// Standard-Renderer zeichnet Glyphen auf ein Canvas, das beim Mounten einer
// echten Terminal-Pane in Tests entsteht) und loggt bei jedem Aufruf lautstark
// über seine eigene virtuelle Console, obwohl xterm.js den resultierenden
// `null`-Kontext bereits klaglos toleriert — dieser Stub liefert denselben
// `null` zurück, nur ohne die Konsolenwarnung.
HTMLCanvasElement.prototype.getContext = vi.fn(
  () => null,
) as typeof HTMLCanvasElement.prototype.getContext;

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
