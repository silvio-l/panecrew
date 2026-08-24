// Covers the generic cross-window pub/sub foundation (frontend counterpart
// to `window_state.rs`) — not the resource popover itself (that's covered
// purely functionally, without IPC, by `resourceUsageTree.test.ts`).
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishWindowState, useCrossWindowState } from "./windowState";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

type ChangedCallback = (event: {
  payload: { windowLabel: string; topic: string; value: unknown };
}) => void;
type RemovedCallback = (event: { payload: { windowLabel: string } }) => void;

function lastChangedCallback(): ChangedCallback | undefined {
  const call = listenMock.mock.calls.find((candidate) => candidate[0] === "window-state:changed");
  return call?.[1] as ChangedCallback | undefined;
}

function lastRemovedCallback(): RemovedCallback | undefined {
  const call = listenMock.mock.calls.find((candidate) => candidate[0] === "window-state:removed");
  return call?.[1] as RemovedCallback | undefined;
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => undefined);
});

describe("publishWindowState", () => {
  it("ruft window_state_publish mit Topic und Wert auf", () => {
    invokeMock.mockResolvedValue(undefined);
    publishWindowState("pane-tree", [{ paneId: "a" }]);
    expect(invokeMock).toHaveBeenCalledWith("window_state_publish", {
      topic: "pane-tree",
      value: [{ paneId: "a" }],
    });
  });
});

describe("useCrossWindowState", () => {
  it("registriert den Change-/Removal-Listener VOR dem Snapshot-Abruf — ein Publish, das genau dazwischen landet, darf nicht verloren gehen", async () => {
    const callOrder: string[] = [];
    listenMock.mockImplementation((event) => {
      callOrder.push(event);
      return Promise.resolve(() => undefined);
    });
    invokeMock.mockImplementation((command) => {
      callOrder.push(command);
      return Promise.resolve({});
    });

    renderHook(() => useCrossWindowState("pane-tree"));

    await waitFor(() => {
      expect(callOrder).toContain("window_state_snapshot");
    });
    expect(callOrder.indexOf("window-state:changed")).toBeLessThan(
      callOrder.indexOf("window_state_snapshot"),
    );
    expect(callOrder.indexOf("window-state:removed")).toBeLessThan(
      callOrder.indexOf("window_state_snapshot"),
    );
  });

  it("übernimmt den Snapshot beim Mount für Fenster, die bereits vor der Registrierung publiziert hatten", async () => {
    invokeMock.mockResolvedValue({ "window-2": ["published-early"] });

    const { result } = renderHook(() => useCrossWindowState<string[]>("pane-tree"));

    await waitFor(() => {
      expect(result.current.get("window-2")).toEqual(["published-early"]);
    });
  });

  it("übernimmt ein Change-Event live, ohne auf den nächsten Snapshot zu warten", async () => {
    invokeMock.mockResolvedValue({});
    const { result } = renderHook(() => useCrossWindowState<string[]>("pane-tree"));
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith("window-state:changed", expect.anything()));

    const onChanged = lastChangedCallback();
    act(() => {
      onChanged?.({ payload: { windowLabel: "window-2", topic: "pane-tree", value: ["live"] } });
    });

    expect(result.current.get("window-2")).toEqual(["live"]);
  });

  it("ignoriert ein Change-Event für ein anderes Topic", async () => {
    invokeMock.mockResolvedValue({});
    const { result } = renderHook(() => useCrossWindowState<string[]>("pane-tree"));
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith("window-state:changed", expect.anything()));

    const onChanged = lastChangedCallback();
    act(() => {
      onChanged?.({ payload: { windowLabel: "window-2", topic: "other-topic", value: ["nope"] } });
    });

    expect(result.current.has("window-2")).toBe(false);
  });

  it("entfernt ein Fenster aus der Map, sobald sein Removal-Event eintrifft (z. B. nach dem Schließen)", async () => {
    invokeMock.mockResolvedValue({ "window-2": ["still-here"] });
    const { result } = renderHook(() => useCrossWindowState<string[]>("pane-tree"));
    await waitFor(() => expect(result.current.get("window-2")).toEqual(["still-here"]));

    const onRemoved = lastRemovedCallback();
    act(() => {
      onRemoved?.({ payload: { windowLabel: "window-2" } });
    });

    expect(result.current.has("window-2")).toBe(false);
  });

  it("kommt mit einem ungestubbten invoke (liefert undefined) klar, statt zu werfen", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCrossWindowState("pane-tree"));
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });
});
