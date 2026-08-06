import { describe, expect, it } from "vitest";
import {
  IDLE_STATE,
  closeFile,
  edit,
  loadFailed,
  loadSucceeded,
  saveFailed,
  saveSucceeded,
  startLoading,
  startSaving,
  wouldLoseWork,
} from "./fileEditorState";

const STAMP = { modified_ms: 1000, len: 42 };
const NEW_STAMP = { modified_ms: 2000, len: 50 };

const ready = () =>
  loadSucceeded(startLoading("a.txt"), "a.txt", {
    text: "hello",
    crlf: false,
    stamp: STAMP,
  });

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

  it("edit setzt den Puffertext und dirty=true", () => {
    const edited = edit(ready(), "geändert");

    expect(edited).toEqual({
      status: "ready",
      path: "a.txt",
      content: "geändert",
      crlf: false,
      stamp: STAMP,
      dirty: true,
    });
  });

  it("edit aus einem save-error heraus kehrt zu ready zurück und verwirft den Fehler", () => {
    const failed = saveFailed(startSaving(edit(ready(), "geändert")), "a.txt", "Fehler", false);

    const edited = edit(failed, "nochmal geändert");

    expect(edited).toEqual({
      status: "ready",
      path: "a.txt",
      content: "nochmal geändert",
      crlf: false,
      stamp: STAMP,
      dirty: true,
    });
  });

  it("edit an einer nicht geladenen Datei ist ein No-Op", () => {
    const loading = startLoading("a.txt");

    expect(edit(loading, "x")).toBe(loading);
  });

  it("startSaving wechselt aus dirty ready in saving, mit demselben Puffer", () => {
    const saving = startSaving(edit(ready(), "geändert"));

    expect(saving).toEqual({
      status: "saving",
      path: "a.txt",
      content: "geändert",
      crlf: false,
      stamp: STAMP,
    });
  });

  it("startSaving an einem sauberen ready ist ein No-Op — nichts zu speichern", () => {
    const clean = ready();

    expect(startSaving(clean)).toBe(clean);
  });

  it("saveSucceeded führt zu ready, dirty=false, mit dem neuen Stamp", () => {
    const saving = startSaving(edit(ready(), "geändert"));

    const saved = saveSucceeded(saving, "a.txt", NEW_STAMP);

    expect(saved).toEqual({
      status: "ready",
      path: "a.txt",
      content: "geändert",
      crlf: false,
      stamp: NEW_STAMP,
      dirty: false,
    });
  });

  it("saveFailed führt zu save-error, Puffer bleibt erhalten", () => {
    const saving = startSaving(edit(ready(), "geändert"));

    const failed = saveFailed(
      saving,
      "a.txt",
      "Datei wurde außerhalb von PaneCrew geändert",
      true,
    );

    expect(failed).toEqual({
      status: "save-error",
      path: "a.txt",
      content: "geändert",
      crlf: false,
      stamp: STAMP,
      message: "Datei wurde außerhalb von PaneCrew geändert",
      conflict: true,
    });
  });

  it("startSaving erlaubt eine Wiederholung direkt aus save-error heraus", () => {
    const failed = saveFailed(startSaving(edit(ready(), "geändert")), "a.txt", "Fehler", false);

    const retrying = startSaving(failed);

    expect(retrying).toEqual({
      status: "saving",
      path: "a.txt",
      content: "geändert",
      crlf: false,
      stamp: STAMP,
    });
  });

  it("saveSucceeded/saveFailed ignorieren eine veraltete Antwort für einen inzwischen verlassenen Pfad", () => {
    const savingOther = startSaving(edit(ready(), "x"));

    expect(saveSucceeded(savingOther, "b.txt", NEW_STAMP)).toBe(savingOther);
    expect(saveFailed(savingOther, "b.txt", "stale", false)).toBe(savingOther);
  });

  it("wouldLoseWork ist nur bei dirty ready, saving oder save-error wahr", () => {
    expect(wouldLoseWork(IDLE_STATE)).toBe(false);
    expect(wouldLoseWork(startLoading("a.txt"))).toBe(false);
    expect(wouldLoseWork(ready())).toBe(false);
    expect(wouldLoseWork(edit(ready(), "geändert"))).toBe(true);
    expect(wouldLoseWork(startSaving(edit(ready(), "geändert")))).toBe(true);
    expect(
      wouldLoseWork(saveFailed(startSaving(edit(ready(), "geändert")), "a.txt", "Fehler", false)),
    ).toBe(true);
  });
});
