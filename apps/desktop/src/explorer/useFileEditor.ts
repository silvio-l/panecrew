import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  type FileEditorState,
  type FileStamp,
} from "./fileEditorState";

interface RawFileContents {
  text: string;
  crlf: boolean;
  stamp: FileStamp;
}

/** Exakter Rust-Fehlertext aus `explorer_write_file` bei einem Stamp-
 * Mismatch (`explorer_fs.rs`) — die einzige Stelle, an der "trotzdem
 * überschreiben" statt nur "erneut versuchen" sinnvoll ist. `.includes`,
 * nicht `===`: eine echte Tauri-Ablehnung liefert den rohen String, ein in
 * Tests bequem erzeugtes `new Error(...)` hängt "Error: " davor. */
const CONFLICT_MESSAGE = "Datei wurde außerhalb von PaneCrew geändert";

export interface FileEditorHandle {
  state: FileEditorState;
  /** Lädt `path` (absoluter Dateipfad) über `explorer_read_file`. Eine
   * bereits laufende, inzwischen überholte Anfrage wird beim Eintreffen
   * ignoriert (siehe `fileEditorState.ts`s `loadSucceeded`/`loadFailed`). */
  open: (path: string) => void;
  close: () => void;
  /** Ändert den Puffertext (nur wirksam aus "ready"/"save-error" heraus, sonst
   * No-Op — siehe `fileEditorState.ts`s `edit`). */
  editContent: (content: string) => void;
  /** Schreibt den aktuellen Puffer über `explorer_write_file`. Ohne `force`
   * wird der beim Laden/letzten erfolgreichen Save erhaltene Stamp mitgesendet
   * (Konflikt möglich); mit `force: true` wird zuerst der aktuelle
   * Platten-Stamp frisch gelesen und der Write damit erzwungen — das ist
   * "trotzdem überschreiben". */
  save: (options?: { force?: boolean }) => void;
  /** Würde ein Wechsel (andere Datei, Projekt, Pane schließen) gerade
   * ungespeicherte Arbeit verwerfen? */
  wouldLoseWork: boolean;
}

/**
 * Dünner React-Wrapper: hält den Zustand aus `fileEditorState.ts` per
 * `useState`, ruft für die eigentliche IPC nur `explorer_read_file`/
 * `explorer_write_file` auf. Bewusst selbst ungetestet (wie
 * `usePtyTerminal.ts`/`useAppZoom.ts`) — die Zustandsübergänge sind in
 * `fileEditorState.test.ts` abgedeckt, die IPC-Verdrahtung im
 * App-Level-Wiring-Test.
 */
export function useFileEditor(): FileEditorHandle {
  const [state, setState] = useState<FileEditorState>(IDLE_STATE);

  const open = (path: string) => {
    setState(startLoading(path));
    void invoke<RawFileContents>("explorer_read_file", { path })
      .then((raw) => setState((current) => loadSucceeded(current, path, raw)))
      .catch((error: unknown) => {
        setState((current) => loadFailed(current, path, String(error)));
      });
  };

  const editContent = (content: string) => {
    setState((current) => edit(current, content));
  };

  const save = (options?: { force?: boolean }) => {
    if (state.status !== "ready" && state.status !== "save-error") return;
    if (state.status === "ready" && !state.dirty) return;
    const { path, content, crlf, stamp } = state;

    const writeWith = (expected: FileStamp) =>
      invoke<FileStamp>("explorer_write_file", { path, contents: content, crlf, expected })
        .then((newStamp) => setState((current) => saveSucceeded(current, path, newStamp)))
        .catch((error: unknown) => {
          const message = String(error);
          setState((current) =>
            saveFailed(current, path, message, message.includes(CONFLICT_MESSAGE)),
          );
        });

    setState(startSaving(state));
    if (options?.force) {
      // "Trotzdem überschreiben": den aktuellen Platten-Stamp frisch holen
      // und damit schreiben, statt den (bewusst veralteten) Stamp aus `state`
      // zu senden — der würde denselben Konflikt sofort wieder auslösen.
      void invoke<RawFileContents>("explorer_read_file", { path })
        .then((raw) => writeWith(raw.stamp))
        .catch((error: unknown) => {
          setState((current) => saveFailed(current, path, String(error), false));
        });
    } else {
      void writeWith(stamp);
    }
  };

  return {
    state,
    open,
    close: () => setState(closeFile()),
    editContent,
    save,
    wouldLoseWork: wouldLoseWork(state),
  };
}
