import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IDLE_STATE,
  closeFile,
  closeIfUnder,
  edit,
  loadFailed,
  loadSucceeded,
  mediaLoadSucceeded,
  renamePath as renamePathTransition,
  saveFailed,
  saveSucceeded,
  startLoading,
  startSaving,
  wouldLoseWork,
  type FileEditorState,
  type FileStamp,
} from "./fileEditorState";
import { mediaInfoForPath } from "./mediaKind";

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
// braucht (nur seine Form, über `FileTabEditors.editorFor`s Rückgabetyp) —
// FileEditor.tsx destrukturiert seine Props direkt, ohne den Typ zu nennen.
interface FileEditorHandle {
  state: FileEditorState;
  /** Lädt `path` (absoluter Dateipfad) über `explorer_read_file`. Eine
   * bereits laufende, inzwischen überholte Anfrage wird beim Eintreffen
   * ignoriert (siehe `fileEditorState.ts`s `loadSucceeded`/`loadFailed`).
   * `line` (Ticket 26, Inhaltssuche): landet unverändert in `jumpToLine`
   * unten, sobald der Ladevorgang „ready" wird — angewendet wird der Sprung
   * selbst erst in `FileEditor.tsx`, das dort den Puffer und dessen
   * Zeilenhöhe kennt. */
  open: (path: string, line?: number) => void;
  close: () => void;
  /** Ändert den Puffertext (nur wirksam aus "ready"/"save-error" heraus, sonst
   * No-Op — siehe `fileEditorState.ts`s `edit`). Ticket 05 (Performance-
   * Audit): ab dem ZWEITEN Tastendruck einer bereits "dirty" Sitzung ist
   * das selbst ein No-Op, s. `editContent` unten — der volle Cross-Pane-
   * Zustand wird dann nicht mehr bei jedem Tastendruck ersetzt. */
  editContent: (content: string) => void;
  /** Schreibt den aktuellen Puffer über `explorer_write_file`. Ohne `force`
   * wird der beim Laden/letzten erfolgreichen Save erhaltene Stamp mitgesendet
   * (Konflikt möglich); mit `force: true` wird zuerst der aktuelle
   * Platten-Stamp frisch gelesen und der Write damit erzwungen — das ist
   * "trotzdem überschreiben". `content` (Ticket 05): der tatsächlich zu
   * schreibende Text, direkt aus der (seit Ticket 05 unkontrollierten)
   * Textarea gelesen — `state.content` selbst kann seit demselben Ticket
   * hinter dem zuletzt getippten Stand zurückbleiben, s. `editContent`.
   * Fehlt `content`, wird `state.content` verwendet (unverändertes
   * Verhalten für Aufrufer, die keinen frischeren Stand kennen). */
  save: (options?: { force?: boolean; content?: string }) => void;
  /** Würde ein Wechsel (andere Datei, Projekt, Pane schließen) gerade
   * ungespeicherte Arbeit verwerfen? */
  wouldLoseWork: boolean;
  /** Nicht-`null`, solange ein von `open(path, line)` angeforderter Sprung
   * noch aussteht — `null` sowohl vor jeder Anfrage als auch, sobald
   * `FileEditor.tsx` ihn per `consumeJumpToLine` angewendet hat. Bleibt
   * während des Ladens stehen (der Puffer existiert erst ab "ready") und
   * verschwindet bei jedem `open()` ohne `line`, damit ein späterer Klick auf
   * eine normale Zeile keinen alten Sprungwunsch aus einer anderen Datei
   * erbt. */
  jumpToLine: number | null;
  /** Meldet einen angewendeten Sprung zurück — sonst würde derselbe
   * Sprungwunsch bei jedem weiteren Render von `FileEditor.tsx` erneut
   * ausgeführt. */
  consumeJumpToLine: () => void;
}

export interface FileTabEditors {
  /** Returns one editor handle per stable file-tab id. Missing ids start at
   * `IDLE_STATE`. */
  editorFor: (fileTabId: string) => FileEditorHandle;
  /** Removes state for a closed file tab to avoid stale dirty flags and an
   * unbounded record of dead ids. */
  forget: (fileTabId: string) => void;
  /** Applies an Explorer rename to every matching open buffer. Paths are
   * absolute. */
  renamePath: (oldPath: string, newPath: string) => void;
  /** Closes every open buffer below a deleted Explorer entry. */
  closeUnder: (deletedPath: string) => void;
}

/**
 * Runs the existing `fileEditorState.ts` state machine independently for each
 * file tab. State transitions are covered by its unit tests and IPC wiring by
 * the App integration tests.
 */
export function useFileTabEditors(onSaved: () => void): FileTabEditors {
  const [states, setStates] = useState<Record<string, FileEditorState>>({});

  const stateFor = (fileTabId: string): FileEditorState =>
    states[fileTabId] ?? IDLE_STATE;

  const updateState = (
    fileTabId: string,
    updater: (current: FileEditorState) => FileEditorState,
  ) => {
    setStates((current) => ({
      ...current,
      [fileTabId]: updater(current[fileTabId] ?? IDLE_STATE),
    }));
  };

  // Getrennt von `states` statt als Feld auf `FileEditorState` (Ticket 26):
  // ein Sprungwunsch ist eine einmalige Randnotiz zu genau EINEM `open()`,
  // keine dauerhafte Eigenschaft eines "ready"-Puffers — er wäre sonst über
  // jede Zustandsübergangsfunktion in `fileEditorState.ts` mitzuführen, ohne
  // dass eine davon ihn tatsächlich braucht.
  const [jumpLines, setJumpLines] = useState<Record<string, number | null>>(
    {},
  );

  const open = (fileTabId: string, path: string, line?: number) => {
    updateState(fileTabId, () => startLoading(path));
    setJumpLines((current) => ({ ...current, [fileTabId]: line ?? null }));

    // Ticket 38: a recognized image/video extension goes through
    // explorer_read_media (raw base64 bytes, no UTF-8 requirement) instead
    // of explorer_read_file — everything else keeps the existing text path
    // below, including its own UTF-8 rejection as the fallback for
    // unsupported binary formats.
    const media = mediaInfoForPath(path);
    if (media) {
      void invoke<string>("explorer_read_media", { path })
        .then((base64) =>
          updateState(fileTabId, (current) =>
            mediaLoadSucceeded(current, path, { ...media, base64 }),
          ),
        )
        .catch((error: unknown) => {
          updateState(fileTabId, (current) =>
            loadFailed(current, path, String(error)),
          );
        });
      return;
    }

    void invoke<RawFileContents>("explorer_read_file", { path })
      .then((raw) =>
        updateState(fileTabId, (current) => loadSucceeded(current, path, raw)),
      )
      .catch((error: unknown) => {
        updateState(fileTabId, (current) =>
          loadFailed(current, path, String(error)),
        );
      });
  };

  const consumeJumpToLine = (fileTabId: string) => {
    setJumpLines((current) => ({ ...current, [fileTabId]: null }));
  };

  const save = (fileTabId: string, options?: { force?: boolean; content?: string }) => {
    const state = stateFor(fileTabId);
    if (state.status !== "ready" && state.status !== "save-error") return;
    if (state.status === "ready" && !state.dirty) return;
    const { path, crlf, stamp } = state;
    // Ticket 05: seit `editContent` unten ab dem zweiten Tastendruck einer
    // Sitzung nichts mehr tut, kann `state.content` hinter dem tatsächlich
    // getippten Stand zurückbleiben — `options.content` (aus der Textarea
    // selbst gelesen, `FileEditor.tsx`s `bufferRef`) ist deshalb die
    // maßgebliche Quelle, `state.content` nur der Fallback für Aufrufer ohne
    // frischeren Stand.
    const content = options?.content ?? state.content;

    const writeWith = (expected: FileStamp) =>
      invoke<FileStamp>("explorer_write_file", {
        path,
        contents: content,
        crlf,
        expected,
      })
        .then((newStamp) => {
          updateState(fileTabId, (current) =>
            saveSucceeded(current, path, newStamp),
          );
          onSaved();
        })
        .catch((error: unknown) => {
          const message = String(error);
          updateState(fileTabId, (current) =>
            saveFailed(current, path, message, message.includes(CONFLICT_MESSAGE)),
          );
        });

    // `edit()` VOR `startSaving()`: trägt den frischen Textarea-Stand (s. o.)
    // noch in den geteilten Zustand ein, bevor der in "saving" einfriert —
    // ohne das schriebe der spätere Fehlerzweig (`saveFailed`) einen
    // veralteten Puffer fest, der dann im "save-error"-Zustand stünde.
    updateState(fileTabId, (current) => startSaving(edit(current, content)));
    if (options?.force) {
      // "Trotzdem überschreiben": den aktuellen Platten-Stamp frisch holen
      // und damit schreiben, statt den (bewusst veralteten) Stamp aus `state`
      // zu senden — der würde denselben Konflikt sofort wieder auslösen.
      void invoke<RawFileContents>("explorer_read_file", { path })
        .then((raw) => writeWith(raw.stamp))
        .catch((error: unknown) => {
          updateState(fileTabId, (current) =>
            saveFailed(current, path, String(error), false),
          );
        });
    } else {
      void writeWith(stamp);
    }
  };

  /**
   * Ticket 05 (Performance-Audit): trägt einen Tastendruck NUR NOCH DANN
   * wirklich in den Pane-übergreifenden Zustand ein, wenn dieser Puffer
   * dadurch ERSTMALS seit dem letzten sauberen/gescheiterten Stand "dirty"
   * wird (oder einen "save-error" verlässt, s. u.) — jeder weitere
   * Tastendruck derselben Sitzung ist hier ein reines No-Op. Vorher ersetzte
   * JEDER Tastendruck den GESAMTEN Record in `states` und riss darüber das
   * ganze Grid (jede Pane, jeden Tab-Chip, den Explorer-Baum) in einen
   * Re-Render — genau das beseitigt dieses Ticket. Der tatsächliche Text
   * lebt bis zum nächsten Checkpoint (Speichern) unverändert im DOM der
   * Textarea selbst (seit Ticket 05 unkontrolliert, `FileEditor.tsx`s
   * `EditorBuffer`); `save()` oben liest ihn dort direkt, dieser Datensatz
   * muss ihn bis dahin nicht führen.
   *
   * `wouldLoseWork` bleibt dabei korrekt: `state.dirty` kippt genau bei
   * diesem einen Update auf `true` und bleibt es unverändert (kein
   * Zeitablauf, keine weitere Bedingung), bis Speichern oder ein neues
   * `open()`/`close()` es zurücksetzt — jeder GUARD (`App.tsx`s
   * `guardLeave` u. a.) liest also weiterhin den korrekten Stand, ganz ohne
   * dass jeder weitere Tastendruck dafür noch etwas tun müsste.
   *
   * Ausnahme "save-error": ein gescheiterter Speicherversuch verwirft seine
   * Fehlermeldung bereits beim NÄCHSTEN Tastendruck (bestehendes,
   * dokumentiertes Verhalten, s. `fileEditorState.ts`s Kommentar an
   * `edit()`) — das bleibt deshalb weiterhin ein echtes, jedes Mal
   * neu prüfendes Update.
   */
  const editContent = (fileTabId: string, content: string) => {
    const current = stateFor(fileTabId);
    if (current.status === "ready" && current.dirty) return;
    updateState(fileTabId, (state) => edit(state, content));
  };

  const editorFor = (fileTabId: string): FileEditorHandle => {
    const state = stateFor(fileTabId);
    return {
      state,
      open: (path: string, line?: number) => open(fileTabId, path, line),
      close: () => updateState(fileTabId, () => closeFile()),
      editContent: (content: string) => editContent(fileTabId, content),
      save: (options?: { force?: boolean; content?: string }) =>
        save(fileTabId, options),
      wouldLoseWork: wouldLoseWork(state),
      jumpToLine: jumpLines[fileTabId] ?? null,
      consumeJumpToLine: () => consumeJumpToLine(fileTabId),
    };
  };

  const forget = (fileTabId: string) => {
    setStates((current) => {
      if (!(fileTabId in current)) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== fileTabId),
      );
    });
    setJumpLines((current) => {
      if (!(fileTabId in current)) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== fileTabId),
      );
    });
  };

  const renamePath = (oldPath: string, newPath: string) => {
    setStates((current) =>
      Object.fromEntries(
        Object.entries(current).map(([fileTabId, state]) => [
          fileTabId,
          renamePathTransition(state, oldPath, newPath),
        ]),
      ),
    );
  };

  const closeUnder = (deletedPath: string) => {
    setStates((current) =>
      Object.fromEntries(
        Object.entries(current).map(([fileTabId, state]) => [
          fileTabId,
          closeIfUnder(state, deletedPath),
        ]),
      ),
    );
  };

  return { editorFor, forget, renamePath, closeUnder };
}
