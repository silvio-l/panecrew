import { describe, expect, it, vi } from "vitest";
import { createResizeGate, type ResizeGateScheduler } from "./resizeGate";

// Ein manuell steuerbarer Fake statt echter Timer: `fire()` löst genau den
// zuletzt geplanten Job aus, `hasPending()` macht sichtbar, ob überhaupt
// debounced statt sofort angewendet wurde. Das ist der ganze Grund, warum
// resizeGate.ts den Scheduler als Parameter nimmt statt selbst setTimeout zu
// rufen (siehe Kopfkommentar dort) — ohne diesen Fake wäre der Debounce-Zweig
// hier gar nicht prüfbar.
function createFakeScheduler(): ResizeGateScheduler & {
  fire: () => void;
  hasPending: () => boolean;
  scheduleCount: () => number;
} {
  let pending: { run: () => void; cancelled: boolean } | null = null;
  let scheduleCount = 0;
  return {
    schedule: (run) => {
      scheduleCount += 1;
      const job = { run, cancelled: false };
      pending = job;
      return () => {
        job.cancelled = true;
        if (pending === job) pending = null;
      };
    },
    fire: () => {
      const job = pending;
      pending = null;
      if (job && !job.cancelled) job.run();
    },
    hasPending: () => pending !== null,
    scheduleCount: () => scheduleCount,
  };
}

describe("createResizeGate", () => {
  it("wendet eine reine Zeilenänderung sofort an, ohne zu debouncen", () => {
    const applyResize = vi.fn();
    const scheduler = createFakeScheduler();
    const { request } = createResizeGate(applyResize, scheduler, {
      getCurrentCols: () => 80,
      bufferLength: () => 10_000,
    });

    request({ cols: 80, rows: 40 });

    expect(applyResize).toHaveBeenCalledExactlyOnceWith({ cols: 80, rows: 40 });
    expect(scheduler.hasPending()).toBe(false);
  });

  it("debounced eine Spaltenänderung bei großem Puffer, statt sofort zu reflowen", () => {
    const applyResize = vi.fn();
    const scheduler = createFakeScheduler();
    const { request } = createResizeGate(applyResize, scheduler, {
      getCurrentCols: () => 80,
      bufferLength: () => 10_000,
    });

    request({ cols: 60, rows: 40 });

    expect(applyResize).not.toHaveBeenCalled();
    expect(scheduler.hasPending()).toBe(true);

    scheduler.fire();
    expect(applyResize).toHaveBeenCalledExactlyOnceWith({ cols: 60, rows: 40 });
  });

  it("wendet nur die LETZTE Spaltenzahl einer Drag-Geste an, nicht jede Zwischengröße", () => {
    // Genau das gemeldete Bild: mehrere Zwischengrößen eines einzigen
    // Fenster-/Pane-Drags dürfen nicht je einen eigenen Reflow (und damit ein
    // eigenes Korruptions-Zeitfenster) auslösen.
    const applyResize = vi.fn();
    const scheduler = createFakeScheduler();
    const { request } = createResizeGate(applyResize, scheduler, {
      getCurrentCols: () => 80,
      bufferLength: () => 10_000,
    });

    request({ cols: 70, rows: 40 });
    request({ cols: 65, rows: 40 });
    request({ cols: 60, rows: 40 });

    expect(applyResize).not.toHaveBeenCalled();
    expect(scheduler.scheduleCount()).toBe(3);

    scheduler.fire();
    expect(applyResize).toHaveBeenCalledExactlyOnceWith({ cols: 60, rows: 40 });
  });

  it("wendet eine Spaltenänderung bei kleinem Puffer trotzdem sofort an", () => {
    const applyResize = vi.fn();
    const scheduler = createFakeScheduler();
    const { request } = createResizeGate(applyResize, scheduler, {
      getCurrentCols: () => 80,
      bufferLength: () => 5,
    });

    request({ cols: 60, rows: 40 });

    expect(applyResize).toHaveBeenCalledExactlyOnceWith({ cols: 60, rows: 40 });
    expect(scheduler.hasPending()).toBe(false);
  });

  it("cancel() verwirft einen noch ausstehenden Resize, statt ihn anzuwenden", () => {
    const applyResize = vi.fn();
    const scheduler = createFakeScheduler();
    const { request, cancel } = createResizeGate(applyResize, scheduler, {
      getCurrentCols: () => 80,
      bufferLength: () => 10_000,
    });

    request({ cols: 60, rows: 40 });
    cancel();
    scheduler.fire();

    expect(applyResize).not.toHaveBeenCalled();
  });

  it("wendet erneut sofort an, sobald die tatsächliche Spaltenzahl die Anfrage schon einholt", () => {
    // getCurrentCols simuliert hier den Terminal-Zustand NACH einem bereits
    // angewendeten Resize -- eine Folgeanfrage mit derselben Spaltenzahl
    // reflowt nichts mehr und darf nicht erneut debouncen.
    const applyResize = vi.fn();
    const scheduler = createFakeScheduler();
    let currentCols = 80;
    const { request } = createResizeGate(applyResize, scheduler, {
      getCurrentCols: () => currentCols,
      bufferLength: () => 10_000,
    });

    request({ cols: 60, rows: 40 });
    expect(scheduler.hasPending()).toBe(true);
    currentCols = 60;
    scheduler.fire();
    applyResize.mockClear();

    request({ cols: 60, rows: 41 });

    expect(applyResize).toHaveBeenCalledExactlyOnceWith({ cols: 60, rows: 41 });
    expect(scheduler.hasPending()).toBe(false);
  });
});
