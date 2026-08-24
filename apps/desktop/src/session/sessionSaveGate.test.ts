import { describe, expect, it, vi } from "vitest";
import { createSessionSaveGate, type SessionSaveGateScheduler } from "./sessionSaveGate";

// Same manually-fireable fake as resizeGate.test.ts, for the same reason:
// without controlling exactly when the debounce fires, the "collapses into
// one write" claim below isn't provable.
function createFakeScheduler(): SessionSaveGateScheduler & {
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

describe("createSessionSaveGate", () => {
  it("does not write immediately — every request debounces", () => {
    const save = vi.fn();
    const scheduler = createFakeScheduler();
    const { request } = createSessionSaveGate(save, scheduler);

    request({ value: 1 });

    expect(save).not.toHaveBeenCalled();
    expect(scheduler.hasPending()).toBe(true);
  });

  it("collapses rapid repeated triggers into a single write after the debounce fires", () => {
    const save = vi.fn();
    const scheduler = createFakeScheduler();
    const { request } = createSessionSaveGate(save, scheduler);

    request({ value: 1 });
    request({ value: 2 });
    request({ value: 3 });

    expect(save).not.toHaveBeenCalled();
    expect(scheduler.scheduleCount()).toBe(3);

    scheduler.fire();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("writes the latest payload at fire time, not a stale intermediate one", () => {
    const save = vi.fn();
    const scheduler = createFakeScheduler();
    const { request } = createSessionSaveGate(save, scheduler);

    request({ value: "stale" });
    request({ value: "latest" });

    scheduler.fire();

    expect(save).toHaveBeenCalledExactlyOnceWith({ value: "latest" });
  });

  it("cancel() discards a still-pending save instead of applying it", () => {
    const save = vi.fn();
    const scheduler = createFakeScheduler();
    const { request, cancel } = createSessionSaveGate(save, scheduler);

    request({ value: 1 });
    cancel();
    scheduler.fire();

    expect(save).not.toHaveBeenCalled();
  });

  it("flush() applies a still-pending save immediately instead of waiting out the debounce", () => {
    const save = vi.fn();
    const scheduler = createFakeScheduler();
    const { request, flush } = createSessionSaveGate(save, scheduler);

    request({ value: 1 });
    void flush();

    expect(save).toHaveBeenCalledExactlyOnceWith({ value: 1 });
    expect(scheduler.hasPending()).toBe(false);
  });

  it("flush() returns save()'s own promise so a caller can await the write landing", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = createFakeScheduler();
    const { request, flush } = createSessionSaveGate(save, scheduler);

    request({ value: 1 });
    await flush();

    expect(save).toHaveBeenCalledExactlyOnceWith({ value: 1 });
  });

  it("flush() is a no-op when nothing is pending", () => {
    const save = vi.fn();
    const scheduler = createFakeScheduler();
    const { flush } = createSessionSaveGate(save, scheduler);

    void flush();

    expect(save).not.toHaveBeenCalled();
  });

  it("flush() does not double-apply once the original timer fires anyway", () => {
    const save = vi.fn();
    const scheduler = createFakeScheduler();
    const { request, flush } = createSessionSaveGate(save, scheduler);

    request({ value: 1 });
    void flush();
    scheduler.fire();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh debounce window for a request arriving after a prior one already fired", () => {
    const save = vi.fn();
    const scheduler = createFakeScheduler();
    const { request } = createSessionSaveGate(save, scheduler);

    request({ value: 1 });
    scheduler.fire();
    save.mockClear();

    request({ value: 2 });

    expect(save).not.toHaveBeenCalled();
    expect(scheduler.hasPending()).toBe(true);

    scheduler.fire();
    expect(save).toHaveBeenCalledExactlyOnceWith({ value: 2 });
  });
});
