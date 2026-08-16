// One shared onboarding-state access point per window, same shape as
// `settings/settingsStore.ts`: a single cached `onboarding_get_state`
// fetch, a single `onboarding:changed` listener, fanned out to every
// consumer instead of each caller (App.tsx, SettingsWindow.tsx's restart
// button) running its own fetch/listen pair.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface OnboardingState {
  completed: boolean;
}

type ChangeListener = (state: OnboardingState) => void;

let cachedState: OnboardingState | null = null;
let fetchPromise: Promise<OnboardingState> | null = null;
let listenPromise: Promise<UnlistenFn> | null = null;
const listeners = new Set<ChangeListener>();

// Same defensive shape as `settingsStore.ts`'s `normalize()`: the real Rust
// command always returns a well-formed `OnboardingState` or rejects, never a
// malformed payload — but callers that stub `invoke` broadly (this app's own
// large `App.test.tsx` suite defaults every unmocked command to
// `Promise.resolve(undefined)`) shouldn't crash every unrelated test just
// because this module started fetching onboarding state unconditionally.
// `completed: true` is the safe default either way: an unknown state should
// never surface a first-run hint.
function normalize(raw: unknown): OnboardingState {
  return typeof raw === "object" && raw !== null && "completed" in raw
    ? (raw as OnboardingState)
    : { completed: true };
}

async function fetchState(): Promise<OnboardingState> {
  const raw = await invoke("onboarding_get_state");
  const state = normalize(raw);
  cachedState = state;
  return state;
}

function ensureListening(): void {
  if (listenPromise) return;
  listenPromise = listen<OnboardingState>("onboarding:changed", (event) => {
    cachedState = event.payload;
    for (const listener of listeners) listener(event.payload);
  });
}

/** Current onboarding state for this window — cached after the first call,
 * deduplicated against an in-flight fetch. */
export function getOnboardingState(): Promise<OnboardingState> {
  ensureListening();
  if (cachedState) return Promise.resolve(cachedState);
  fetchPromise ??= fetchState().finally(() => {
    fetchPromise = null;
  });
  return fetchPromise;
}

/** Subscribes to live onboarding-state changes (fired from any window, e.g.
 * the Settings restart button). Returns an unsubscribe function. */
export function subscribeToOnboardingChanges(listener: ChangeListener): () => void {
  ensureListening();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Persists completion and broadcasts it to every window. Used both by the
 * Aha-Moment auto-complete in App.tsx (`completed: true`) and the Settings
 * restart button (`completed: false`, re-arming the hint). */
export function setOnboardingCompleted(completed: boolean): Promise<void> {
  return invoke("onboarding_set_completed", { completed });
}

/** Test-only reset, same rationale as `resetSettingsStoreForTests`. */
export function resetOnboardingStoreForTests(): void {
  cachedState = null;
  fetchPromise = null;
  listenPromise = null;
  listeners.clear();
}
