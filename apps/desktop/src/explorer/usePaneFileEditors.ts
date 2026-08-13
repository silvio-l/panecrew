import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IDLE_STATE,
  closeFile,
  closeIfUnder,
  edit,
  loadFailed,
  loadSucceeded,
  renamePath as renamePathTransition,
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

// Nicht exportiert, solange nichts außerhalb dieser Datei den Typ selbst
// braucht (nur seine Form, über `PaneFileEditors.editorFor`s Rückgabetyp) —
// FileEditor.tsx destrukturiert seine Props direkt, ohne den Typ zu nennen.
interface FileEditorHandle {
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

export interface PaneFileEditors {
  /** Die `FileEditorHandle` einer Pane — exakt dieselbe Form, die vorher
   * `useFileEditor` als einzige Instanz lieferte, hier eine pro `paneId`
   * (fehlender Key ⇒ `IDLE_STATE`). `FileEditor.tsx` bleibt dadurch
   * unangetastet: es sieht weiterhin nur eine `FileEditorHandle`. */
  editorFor: (paneId: string) => FileEditorHandle;
  /** Entfernt den Zustand einer geschlossenen/neu zugewiesenen Pane, damit
   * sie nicht für immer `wouldLoseWork === true` hält und der Record nicht
   * unbegrenzt mit toten `paneId`s wächst. Eine `paneId` wird nie
   * wiederverwendet (jede Neuzuweisung erzeugt eine frische), Vergessen ist
   * also reine Aufräumarbeit, keine Korrektheitsfrage. */
  forget: (paneId: string) => void;
  /** Trägt jeden offenen Puffer (über ALLE Panes hinweg) über eine Explorer-
   * Umbenennung (Ticket 24) hinweg mit — siehe `fileEditorState.ts`s
   * `renamePath`. `oldPath`/`newPath` sind absolute Pfade. */
  renamePath: (oldPath: string, newPath: string) => void;
  /** Schließt jeden offenen Puffer (über ALLE Panes hinweg), der unter einem
   * soeben gelöschten Explorer-Eintrag lag — siehe `fileEditorState.ts`s
   * `closeIfUnder`. `deletedPath` ist ein absoluter Pfad. */
  closeUnder: (deletedPath: string) => void;
}

/**
 * Ersetzt `useFileEditor.ts`: derselbe Zustandsautomat aus
 * `fileEditorState.ts`, jetzt einmal pro Pane statt einmal pro App, weil mit
 * dem Grid (Ticket 03) jede Pane unabhängig eine Datei offen haben kann.
 * Bewusst selbst ungetestet (wie `usePtyTerminal.ts`/`useAppZoom.ts`) — die
 * Zustandsübergänge sind in `fileEditorState.test.ts` abgedeckt, die
 * IPC-Verdrahtung im App-Level-Wiring-Test.
 */
export function usePaneFileEditors(onSaved: () => void): PaneFileEditors {
  const [states, setStates] = useState<Record<string, FileEditorState>>({});

  const stateFor = (paneId: string): FileEditorState =>
    states[paneId] ?? IDLE_STATE;

  const updateState = (
    paneId: string,
    updater: (current: FileEditorState) => FileEditorState,
  ) => {
    setStates((current) => ({
      ...current,
      [paneId]: updater(current[paneId] ?? IDLE_STATE),
    }));
  };

  const open = (paneId: string, path: string) => {
    updateState(paneId, () => startLoading(path));
    void invoke<RawFileContents>("explorer_read_file", { path })
      .then((raw) =>
        updateState(paneId, (current) => loadSucceeded(current, path, raw)),
      )
      .catch((error: unknown) => {
        updateState(paneId, (current) =>
          loadFailed(current, path, String(error)),
        );
      });
  };

  const save = (paneId: string, options?: { force?: boolean }) => {
    const state = stateFor(paneId);
    if (state.status !== "ready" && state.status !== "save-error") return;
    if (state.status === "ready" && !state.dirty) return;
    const { path, content, crlf, stamp } = state;

    const writeWith = (expected: FileStamp) =>
      invoke<FileStamp>("explorer_write_file", {
        path,
        contents: content,
        crlf,
        expected,
      })
        .then((newStamp) => {
          updateState(paneId, (current) =>
            saveSucceeded(current, path, newStamp),
          );
          onSaved();
        })
        .catch((error: unknown) => {
          const message = String(error);
          updateState(paneId, (current) =>
            saveFailed(current, path, message, message.includes(CONFLICT_MESSAGE)),
          );
        });

    updateState(paneId, () => startSaving(state));
    if (options?.force) {
      // "Trotzdem überschreiben": den aktuellen Platten-Stamp frisch holen
      // und damit schreiben, statt den (bewusst veralteten) Stamp aus `state`
      // zu senden — der würde denselben Konflikt sofort wieder auslösen.
      void invoke<RawFileContents>("explorer_read_file", { path })
        .then((raw) => writeWith(raw.stamp))
        .catch((error: unknown) => {
          updateState(paneId, (current) =>
            saveFailed(current, path, String(error), false),
          );
        });
    } else {
      void writeWith(stamp);
    }
  };

  const editorFor = (paneId: string): FileEditorHandle => {
    const state = stateFor(paneId);
    return {
      state,
      open: (path: string) => open(paneId, path),
      close: () => updateState(paneId, () => closeFile()),
      editContent: (content: string) =>
        updateState(paneId, (current) => edit(current, content)),
      save: (options?: { force?: boolean }) => save(paneId, options),
      wouldLoseWork: wouldLoseWork(state),
    };
  };

  const forget = (paneId: string) => {
    setStates((current) => {
      if (!(paneId in current)) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== paneId),
      );
    });
  };

  const renamePath = (oldPath: string, newPath: string) => {
    setStates((current) =>
      Object.fromEntries(
        Object.entries(current).map(([paneId, state]) => [
          paneId,
          renamePathTransition(state, oldPath, newPath),
        ]),
      ),
    );
  };

  const closeUnder = (deletedPath: string) => {
    setStates((current) =>
      Object.fromEntries(
        Object.entries(current).map(([paneId, state]) => [
          paneId,
          closeIfUnder(state, deletedPath),
        ]),
      ),
    );
  };

  return { editorFor, forget, renamePath, closeUnder };
}
