// Reine Zustandsübergänge für den Mini-Editor (.scratch/explorer-file-io/),
// bewusst ohne React- und ohne Tauri-IPC-Import — derselbe
// Pure-Logik-aus-dem-Hook-herausgezogen-Schnitt wie `terminal/ptyIo.ts` und
// `shortcuts/zoom.ts`. Der eigentliche Hook (`useFileEditor.ts`) hält den
// State per `useState` und ruft ausschließlich diese Funktionen auf.

import type { MediaKind } from "./mediaKind";

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
  // Ticket 38 (image/video preview): a read-only render mode alongside
  // "ready" — no `dirty`/`stamp`, since there is no buffer to save and thus
  // nothing that could go stale. Populated via explorer_read_media instead
  // of explorer_read_file (see useFileTabEditors.ts's `open`), routed by
  // extension through mediaKind.ts's `mediaInfoForPath`.
  | {
      status: "media";
      path: string;
      kind: MediaKind;
      mime: string;
      base64: string;
    }
  | {
      status: "ready";
      path: string;
      content: string;
      crlf: boolean;
      stamp: FileStamp;
      dirty: boolean;
    }
  // `saving`/`save-error` tragen kein eigenes `dirty` — beide bedeuten es
  // immer (man kommt nur aus einem dirty "ready" oder einem vorherigen
  // "save-error" hierher), ein zusätzliches Feld könnte also nur mit sich
  // selbst widersprechen.
  | {
      status: "saving";
      path: string;
      content: string;
      crlf: boolean;
      stamp: FileStamp;
    }
  | {
      status: "save-error";
      path: string;
      content: string;
      crlf: boolean;
      stamp: FileStamp;
      message: string;
      /** Unterscheidet einen Stamp-Konflikt (externe Änderung, "trotzdem
       * überschreiben" ist eine sinnvolle Option) von jedem anderen
       * Schreibfehler (Berechtigung, volle Platte, …), wo Überschreiben
       * genau das gleiche Ergebnis wie der letzte Versuch hätte. */
      conflict: boolean;
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

/** Same stale-response guard as `loadSucceeded` above, for the media
 * preview's own IPC call (explorer_read_media, see useFileTabEditors.ts). */
export function mediaLoadSucceeded(
  state: FileEditorState,
  path: string,
  media: { kind: MediaKind; mime: string; base64: string },
): FileEditorState {
  if (state.status !== "loading" || state.path !== path) return state;
  return {
    status: "media",
    path,
    kind: media.kind,
    mime: media.mime,
    base64: media.base64,
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

/** Ändert den Puffertext und setzt dirty. Aus `save-error` heraus (ein
 * fehlgeschlagener Speicherversuch) bleibt der Text weiter änderbar — der
 * Fehler wird beim nächsten Tippen verworfen, nicht erst beim nächsten Save. */
export function edit(state: FileEditorState, content: string): FileEditorState {
  if (state.status === "ready") {
    return { ...state, content, dirty: true };
  }
  if (state.status === "save-error") {
    return {
      status: "ready",
      path: state.path,
      content,
      crlf: state.crlf,
      stamp: state.stamp,
      dirty: true,
    };
  }
  return state;
}

/** Erlaubt aus einem dirty "ready" (normaler Save) UND aus "save-error"
 * (Wiederholung, z. B. "trotzdem überschreiben") — beide tragen bereits den
 * zu schreibenden Puffer. Ein sauberes "ready" (nicht dirty) hat nichts zu
 * speichern und bleibt unverändert. */
export function startSaving(state: FileEditorState): FileEditorState {
  if (state.status === "ready" && state.dirty) {
    return {
      status: "saving",
      path: state.path,
      content: state.content,
      crlf: state.crlf,
      stamp: state.stamp,
    };
  }
  if (state.status === "save-error") {
    return {
      status: "saving",
      path: state.path,
      content: state.content,
      crlf: state.crlf,
      stamp: state.stamp,
    };
  }
  return state;
}

export function saveSucceeded(
  state: FileEditorState,
  path: string,
  stamp: FileStamp,
): FileEditorState {
  if (state.status !== "saving" || state.path !== path) return state;
  return {
    status: "ready",
    path,
    content: state.content,
    crlf: state.crlf,
    stamp,
    dirty: false,
  };
}

export function saveFailed(
  state: FileEditorState,
  path: string,
  message: string,
  conflict: boolean,
): FileEditorState {
  if (state.status !== "saving" || state.path !== path) return state;
  return {
    status: "save-error",
    path,
    content: state.content,
    crlf: state.crlf,
    stamp: state.stamp,
    message,
    conflict,
  };
}

/** Trägt einen Puffer über eine Explorer-Umbenennung hinweg (Ticket 24) mit,
 * OHNE ihn neu von der Platte zu lesen: `explorer_rename` verschiebt nur den
 * Dateinamen, der Inhalt bleibt exakt, was er war — ein Neuladen würde also
 * bestenfalls nichts ändern und schlimmstenfalls einen ungespeicherten Stand
 * lautlos verwerfen. Wirkt auf `oldPath` selbst UND auf jeden Pfad darunter
 * (ein Ordner wurde umbenannt, diese Datei lag darin) — beides dieselbe
 * Präfix-Ersetzung. Jeder andere offene Pfad bleibt unverändert. */
export function renamePath(
  state: FileEditorState,
  oldPath: string,
  newPath: string,
): FileEditorState {
  if (state.status === "idle") return state;
  if (state.path !== oldPath && !state.path.startsWith(`${oldPath}/`)) {
    return state;
  }
  return { ...state, path: newPath + state.path.slice(oldPath.length) };
}

/** Schließt einen offenen Puffer, dessen Pfad unter einem soeben gelöschten
 * Eintrag liegt (die Datei selbst oder ein Ordner, der sie enthielt) — die
 * Datei existiert danach nicht mehr, ein weiterhin offener Editor darauf
 * wäre eine Fläche ohne Gegenstück auf der Platte. Anders als bei
 * `renamePath` gibt es hier nichts zu erhalten: ein ungespeicherter Stand
 * ginge so oder so verloren, die Löschung selbst hat ihn bereits entschieden. */
export function closeIfUnder(
  state: FileEditorState,
  deletedPath: string,
): FileEditorState {
  if (state.status === "idle") return state;
  if (state.path !== deletedPath && !state.path.startsWith(`${deletedPath}/`)) {
    return state;
  }
  return IDLE_STATE;
}

/** Genau dann true, wenn ein Wechsel (andere Datei, Projekt, Pane schließen)
 * einen ungespeicherten Stand kosten würde. */
export function wouldLoseWork(state: FileEditorState): boolean {
  return (
    (state.status === "ready" && state.dirty) ||
    state.status === "saving" ||
    state.status === "save-error"
  );
}
