// Reine Zustandsübergänge für den Mini-Editor (.scratch/explorer-file-io/),
// bewusst ohne React- und ohne Tauri-IPC-Import — derselbe
// Pure-Logik-aus-dem-Hook-herausgezogen-Schnitt wie `terminal/ptyIo.ts` und
// `shortcuts/zoom.ts`. Der eigentliche Hook (`useFileEditor.ts`) hält den
// State per `useState` und ruft ausschließlich diese Funktionen auf.

/** Deckt sich bewusst 1:1 mit dem Rust-`FileStamp` aus `explorer_fs.rs` (kein
 * `serde(rename_all)` dort, also keine Umbenennung nötig). */
export interface FileStamp {
  modified_ms: number;
  len: number;
}

export type FileEditorState =
  | { status: "idle" }
  | { status: "loading"; path: string }
  | { status: "load-error"; path: string; message: string }
  | {
      status: "ready";
      path: string;
      content: string;
      crlf: boolean;
      stamp: FileStamp;
      dirty: boolean;
    };

export const IDLE_STATE: FileEditorState = { status: "idle" };

export function startLoading(path: string): FileEditorState {
  return { status: "loading", path };
}

/**
 * Ignoriert eine Antwort, die nicht mehr zum inzwischen angeforderten Pfad
 * gehört (Nutzer hat währenddessen eine andere Datei angeklickt) — derselbe
 * Schutz, den `App.tsx`s `refreshExplorer` schon für Projekt-Reads einsetzt.
 */
export function loadSucceeded(
  state: FileEditorState,
  path: string,
  loaded: { text: string; crlf: boolean; stamp: FileStamp },
): FileEditorState {
  if (state.status !== "loading" || state.path !== path) return state;
  return {
    status: "ready",
    path,
    content: loaded.text,
    crlf: loaded.crlf,
    stamp: loaded.stamp,
    dirty: false,
  };
}

export function loadFailed(
  state: FileEditorState,
  path: string,
  message: string,
): FileEditorState {
  if (state.status !== "loading" || state.path !== path) return state;
  return { status: "load-error", path, message };
}

export function closeFile(): FileEditorState {
  return IDLE_STATE;
}
