import { describe, expect, it } from "vitest";
import {
  IDLE_STATE,
  closeFile,
  loadFailed,
  loadSucceeded,
  startLoading,
} from "./fileEditorState";

const STAMP = { modified_ms: 1000, len: 42 };

describe("fileEditorState", () => {
  it("startet im idle-Zustand", () => {
    expect(IDLE_STATE).toEqual({ status: "idle" });
  });

  it("startLoading wechselt in den Ladezustand mit dem angeforderten Pfad", () => {
    expect(startLoading("src/App.tsx")).toEqual({
      status: "loading",
      path: "src/App.tsx",
    });
  });

  it("loadSucceeded führt zu geladenem Zustand mit dirty=false", () => {
    const loading = startLoading("src/App.tsx");

    const ready = loadSucceeded(loading, "src/App.tsx", {
      text: "hello",
      crlf: false,
      stamp: STAMP,
    });

    expect(ready).toEqual({
      status: "ready",
      path: "src/App.tsx",
      content: "hello",
      crlf: false,
      stamp: STAMP,
      dirty: false,
    });
  });

  it("loadFailed führt zu einem Fehlerzustand mit der Meldung", () => {
    const loading = startLoading("huge.bin");

    const failed = loadFailed(loading, "huge.bin", "Datei ist zu groß für den Editor");

    expect(failed).toEqual({
      status: "load-error",
      path: "huge.bin",
      message: "Datei ist zu groß für den Editor",
    });
  });

  it("ignoriert eine veraltete Antwort für einen inzwischen verlassenen Pfad", () => {
    const stillLoadingOther = startLoading("second.txt");

    const afterStaleSuccess = loadSucceeded(stillLoadingOther, "first.txt", {
      text: "stale",
      crlf: false,
      stamp: STAMP,
    });
    const afterStaleFailure = loadFailed(stillLoadingOther, "first.txt", "stale error");

    expect(afterStaleSuccess).toBe(stillLoadingOther);
    expect(afterStaleFailure).toBe(stillLoadingOther);
  });

  it("closeFile geht immer zurück in den idle-Zustand", () => {
    expect(closeFile()).toEqual(IDLE_STATE);
  });
});
