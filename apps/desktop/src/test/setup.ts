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
