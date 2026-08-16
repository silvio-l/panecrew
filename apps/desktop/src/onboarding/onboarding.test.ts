import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOnboardingState,
  resetOnboardingStoreForTests,
  setOnboardingCompleted,
  subscribeToOnboardingChanges,
} from "./onboarding";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

interface OnboardingStatePayload {
  completed: boolean;
}
type ChangedCallback = (event: { payload: OnboardingStatePayload }) => void;

function callsWith(mockFn: typeof invokeMock | typeof listenMock, arg0: string): number {
  return mockFn.mock.calls.filter((call) => call[0] === arg0).length;
}

function lastChangedCallback(): ChangedCallback | undefined {
  const call = listenMock.mock.calls.find((candidate) => candidate[0] === "onboarding:changed");
  return call?.[1] as ChangedCallback | undefined;
}

beforeEach(() => {
  resetOnboardingStoreForTests();
  invokeMock.mockReset();
  listenMock.mockClear();
  invokeMock.mockImplementation((cmd) => {
    if (cmd === "onboarding_get_state") return Promise.resolve({ completed: false });
    return Promise.resolve(undefined);
  });
});

describe("onboarding — Store-Grundverhalten", () => {
  it("dedupliziert mehrere gleichzeitige getOnboardingState()-Aufrufe auf genau einen invoke", async () => {
    const [a, b, c] = await Promise.all([
      getOnboardingState(),
      getOnboardingState(),
      getOnboardingState(),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(callsWith(invokeMock, "onboarding_get_state")).toBe(1);
  });

  it("liefert bei einem späteren Aufruf den zwischengespeicherten Stand ohne erneuten invoke", async () => {
    await getOnboardingState();
    invokeMock.mockClear();

    await getOnboardingState();

    expect(callsWith(invokeMock, "onboarding_get_state")).toBe(0);
  });

  it("registriert nur einen onboarding:changed-Listener, egal wie oft subscribeToOnboardingChanges aufgerufen wird", () => {
    const unsubs = [
      subscribeToOnboardingChanges(() => undefined),
      subscribeToOnboardingChanges(() => undefined),
      subscribeToOnboardingChanges(() => undefined),
    ];

    expect(callsWith(listenMock, "onboarding:changed")).toBe(1);

    unsubs.forEach((unsubscribe) => unsubscribe());
  });

  it("setOnboardingCompleted ruft onboarding_set_completed mit dem übergebenen Wert auf", async () => {
    await setOnboardingCompleted(true);

    expect(invokeMock).toHaveBeenCalledWith("onboarding_set_completed", { completed: true });
  });

  it("ein onboarding:changed-Event aktualisiert den zwischengespeicherten Stand und erreicht jeden Subscriber", async () => {
    await getOnboardingState();
    const received: OnboardingStatePayload[] = [];
    subscribeToOnboardingChanges((state) => received.push(state));

    const changed = lastChangedCallback();
    changed?.({ payload: { completed: true } });

    expect(received).toEqual([{ completed: true }]);

    invokeMock.mockClear();
    await expect(getOnboardingState()).resolves.toEqual({ completed: true });
    expect(callsWith(invokeMock, "onboarding_get_state")).toBe(0);
  });
});
