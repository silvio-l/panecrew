import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IDLE_STATE,
  closeFile,
  loadFailed,
  loadSucceeded,
  startLoading,
  type FileEditorState,
  type FileStamp,
} from "./fileEditorState";

interface RawFileContents {
  text: string;
  crlf: boolean;
  stamp: FileStamp;
}

export interface FileEditorHandle {
  state: FileEditorState;
  /** Lädt `path` (absoluter Dateipfad) über `explorer_read_file`. Eine
   * bereits laufende, inzwischen überholte Anfrage wird beim Eintreffen
   * ignoriert (siehe `fileEditorState.ts`s `loadSucceeded`/`loadFailed`). */
  open: (path: string) => void;
  close: () => void;
}

/**
 * Dünner React-Wrapper: hält den Zustand aus `fileEditorState.ts` per
 * `useState`, ruft für die eigentliche IPC nur `explorer_read_file` auf.
 * Bewusst selbst ungetestet (wie `usePtyTerminal.ts`/`useAppZoom.ts`) — die
 * Zustandsübergänge sind in `fileEditorState.test.ts` abgedeckt, die
 * IPC-Verdrahtung im App-Level-Wiring-Test.
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

  return { state, open, close: () => setState(closeFile()) };
}
