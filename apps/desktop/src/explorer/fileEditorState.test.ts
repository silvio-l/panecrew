import { describe, expect, it } from "vitest";
import {
  IDLE_STATE,
  closeFile,
  closeIfUnder,
  edit,
  loadFailed,
  loadSucceeded,
  mediaLoadSucceeded,
  renamePath,
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

  it("renamePath ersetzt den Pfad, wenn er genau dem umbenannten Eintrag entspricht", () => {
    expect(renamePath(ready(), "a.txt", "b.txt")).toEqual({
      ...ready(),
      path: "b.txt",
    });
  });

  it("renamePath trägt einen Pfad UNTER einem umbenannten Ordner mit", () => {
    const insideFolder = loadSucceeded(startLoading("src/old/App.tsx"), "src/old/App.tsx", {
      text: "hello",
      crlf: false,
      stamp: STAMP,
    });

    expect(renamePath(insideFolder, "src/old", "src/new")).toEqual({
      ...insideFolder,
      path: "src/new/App.tsx",
    });
  });

  it("renamePath lässt einen unbeteiligten Pfad unverändert", () => {
    const state = ready();
    expect(renamePath(state, "other.txt", "renamed.txt")).toBe(state);
  });

  it("renamePath an idle ist ein No-Op", () => {
    expect(renamePath(IDLE_STATE, "a.txt", "b.txt")).toBe(IDLE_STATE);
  });

  it("closeIfUnder schließt einen Puffer, dessen Pfad genau der gelöschte Eintrag ist", () => {
    expect(closeIfUnder(ready(), "a.txt")).toEqual(IDLE_STATE);
  });

  it("closeIfUnder schließt einen Puffer UNTER einem gelöschten Ordner", () => {
    const insideFolder = loadSucceeded(startLoading("src/old/App.tsx"), "src/old/App.tsx", {
      text: "hello",
      crlf: false,
      stamp: STAMP,
    });

    expect(closeIfUnder(insideFolder, "src/old")).toEqual(IDLE_STATE);
  });

  it("closeIfUnder lässt einen unbeteiligten Puffer unverändert", () => {
    const state = ready();
    expect(closeIfUnder(state, "other.txt")).toBe(state);
  });

  it("closeIfUnder an idle ist ein No-Op", () => {
    expect(closeIfUnder(IDLE_STATE, "a.txt")).toBe(IDLE_STATE);
  });

  it("mediaLoadSucceeded führt zum media-Zustand mit Art/MIME/Base64 (Ticket 38)", () => {
    const loading = startLoading("logo.png");

    const media = mediaLoadSucceeded(loading, "logo.png", {
      kind: "image",
      mime: "image/png",
      base64: "QUJD",
    });

    expect(media).toEqual({
      status: "media",
      path: "logo.png",
      kind: "image",
      mime: "image/png",
      base64: "QUJD",
    });
  });

  it("mediaLoadSucceeded ignoriert eine veraltete Antwort für einen inzwischen verlassenen Pfad", () => {
    const stillLoadingOther = startLoading("second.png");

    const afterStale = mediaLoadSucceeded(stillLoadingOther, "first.png", {
      kind: "image",
      mime: "image/png",
      base64: "stale",
    });

    expect(afterStale).toBe(stillLoadingOther);
  });

  it("media zählt nicht als ungespeicherte Arbeit — reine Vorschau, kein Puffer", () => {
    const media = mediaLoadSucceeded(startLoading("logo.png"), "logo.png", {
      kind: "image",
      mime: "image/png",
      base64: "QUJD",
    });

    expect(wouldLoseWork(media)).toBe(false);
  });

  it("renamePath/closeIfUnder wirken auch auf den media-Zustand", () => {
    const media = mediaLoadSucceeded(startLoading("old/logo.png"), "old/logo.png", {
      kind: "image",
      mime: "image/png",
      base64: "QUJD",
    });

    expect(renamePath(media, "old", "new")).toEqual({ ...media, path: "new/logo.png" });
    expect(closeIfUnder(media, "old")).toEqual(IDLE_STATE);
  });
});
