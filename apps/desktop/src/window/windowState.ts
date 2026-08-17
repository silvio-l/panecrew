// Frontend counterpart to `window_state.rs`: generic, topic-keyed pub/sub for
// state that lives only in ONE window's React state (never persisted to the
// backend) but that another window still wants to read — e.g. the pane/tab
// structure for the resource popover (`resourceUsageTree.ts`). Deliberately
// minimal: ONE publish call, ONE snapshot call, ONE change event, ONE removal
// event — every future cross-window feature reuses this same trio instead of
// inventing its own event pair (same reuse pattern as
// `settingsStore.ts`/`useSettings.ts`, just without its app-wide
// single-fetch dedup, which a second consumer of the same topic doesn't need
// yet).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const CHANGED_EVENT = "window-state:changed";
const REMOVED_EVENT = "window-state:removed";

interface ChangedPayload {
  windowLabel: string;
  topic: string;
  value: unknown;
}

interface RemovedPayload {
  windowLabel: string;
}

/** Publishes `value` under `topic` as this window's own entry — overwrites
 * whatever this window previously published under the same topic.
 * Fire-and-forget like every other plain broadcast in this app (including
 * `settingsStore.ts`'s own save calls) — a failure here only leaves other
 * windows on a stale value, nothing that should block this window itself. */
export function publishWindowState(topic: string, value: unknown): void {
  invoke("window_state_publish", { topic, value }).catch((error: unknown) => {
    console.error(`PaneCrew: window_state_publish("${topic}") failed`, error);
  });
}

/** Current state of every window for `topic`, for a freshly mounted consumer
 * that needs to catch up on entries published before its own `listen()` —
 * the change event alone only reaches listeners already registered.
 * Tolerant of an unstubbed `invoke` in consumer tests (returns `undefined`
 * there, see `useSettings.ts`'s comment of the same name) instead of
 * throwing. */
async function snapshotWindowState(topic: string): Promise<Record<string, unknown>> {
  const result = await invoke("window_state_snapshot", { topic });
  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
}

/** Window→value map for `topic`, kept live via a snapshot plus change/removal
 * events. The listener is registered BEFORE the snapshot call (`await`s in
 * this order) — otherwise a publish landing exactly between the snapshot
 * response and listener registration could be lost until the next
 * (possibly rare) publish under this topic. Returns a `Map` instead of an
 * object — no `in`/`delete` on dynamic keys needed, and callers like
 * `groupTabUsageByWindow` expect a map anyway. */
export function useCrossWindowState<T>(topic: string): ReadonlyMap<string, T> {
  const [state, setState] = useState<ReadonlyMap<string, T>>(new Map());

  useEffect(() => {
    let cancelled = false;
    // TypeScript narrows a captured `let` to its last-checked literal value
    // across an `await` — it doesn't know the cleanup closure below can flip
    // it in between. Reading it back through a function call sidesteps that,
    // same pattern as `ExplorerPanel.tsx`'s initial-expand effect.
    const isCancelled = () => cancelled;
    let unlistenChanged: UnlistenFn | undefined;
    let unlistenRemoved: UnlistenFn | undefined;

    void (async () => {
      unlistenChanged = await listen<ChangedPayload>(CHANGED_EVENT, (event) => {
        if (event.payload.topic !== topic) return;
        const { windowLabel, value } = event.payload;
        setState((prev) => new Map(prev).set(windowLabel, value as T));
      });
      unlistenRemoved = await listen<RemovedPayload>(REMOVED_EVENT, (event) => {
        const { windowLabel } = event.payload;
        setState((prev) => {
          if (!prev.has(windowLabel)) return prev;
          const next = new Map(prev);
          next.delete(windowLabel);
          return next;
        });
      });
      if (isCancelled()) {
        unlistenChanged();
        unlistenRemoved();
        return;
      }

      const snapshot = await snapshotWindowState(topic);
      if (isCancelled()) return;
      // Snapshot first, then `prev` layered on top: a change event that
      // arrived between the snapshot call and its response already set a
      // fresher value in `prev` and must not be overwritten by the (now
      // stale) snapshot.
      setState((prev) => new Map([...Object.entries(snapshot), ...prev] as [string, T][]));
    })();

    return () => {
      cancelled = true;
      unlistenChanged?.();
      unlistenRemoved?.();
    };
  }, [topic]);

  return state;
}
