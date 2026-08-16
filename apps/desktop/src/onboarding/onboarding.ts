// One shared onboarding-state access point per window, same shape as
// `settings/settingsStore.ts`: a single cached `onboarding_get_state`
// fetch, a single `onboarding:changed` listener, fanned out to every
// consumer instead of each caller (App.tsx, SettingsWindow.tsx's restart
// button) running its own fetch/listen pair.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface OnboardingState {
  completed: boolean;
  /** Phase 1, the Initial-Setup-Wizard — distinct from `completed` (phase 2,
   * the in-app tour reaching the Aha-Moment). See `onboarding_store.rs`'s
   * module doc comment for the pre-wizard migration this field needed. */
  wizardCompleted: boolean;
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
// `{completed: true, wizardCompleted: true}` is the safe default either
// way: an unknown state should never surface first-run UI.
function normalize(raw: unknown): OnboardingState {
  if (typeof raw !== "object" || raw === null || !("completed" in raw)) {
    return { completed: true, wizardCompleted: true };
  }
  const partial = raw as Partial<OnboardingState>;
  return {
    completed: partial.completed ?? true,
    wizardCompleted: partial.wizardCompleted ?? true,
  };
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

/** Persists phase-2 (tour) completion and broadcasts it to every window.
 * Used by the Aha-Moment auto-complete in App.tsx (`completed: true`) and
 * by the tour's own skip control (`completed: false` is never called here
 * directly — see `restartOnboarding` for re-arming both phases at once). */
export function setOnboardingCompleted(completed: boolean): Promise<void> {
  return invoke("onboarding_set_completed", { completed });
}

/** Persists phase-1 (wizard) completion and broadcasts it. */
export function setOnboardingWizardCompleted(completed: boolean): Promise<void> {
  return invoke("onboarding_set_wizard_completed", { completed });
}

/** Resets BOTH phases at once — the Settings "Einführung neu starten"
 * button. Grid-independent by construction: the wizard is an app-window
 * overlay, not anchored to an empty slot, so this reliably shows something
 * regardless of how full the grid currently is (unlike a bare
 * `setOnboardingCompleted(false)`, which only ever re-arms the phase-2
 * hint, and only shows anything at all when the grid happens to have a
 * free slot for it to anchor to). */
export function restartOnboarding(): Promise<void> {
  return invoke("onboarding_restart");
}

/** Test-only reset, same rationale as `resetSettingsStoreForTests`. */
export function resetOnboardingStoreForTests(): void {
  cachedState = null;
  fetchPromise = null;
  listenPromise = null;
  listeners.clear();
}
