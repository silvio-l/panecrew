import { invoke } from "@tauri-apps/api/core";

// Wo eine Pane gerade steht — und ob ein Pfad von dort aus existiert.
//
// Beides braucht die Inline-Vervollständigung, um `cd`-Vorschläge ehrlich zu
// halten: History-Dateien speichern kein Arbeitsverzeichnis, ein einmal
// getipptes `cd Desktop` sagt also nichts darüber, ob es HIER ein `Desktop`
// gibt.

export interface ReportedDirectory {
  /** Der meldende Rechner; leer, wenn die Shell keinen Namen kennt. */
  host: string;
  path: string;
}

/**
 * Das Verzeichnis aus einer OSC-7-Meldung (`file://host/pfad`), oder null.
 *
 * OSC 7 ist der Weg, auf dem eine Shell ihr Arbeitsverzeichnis meldet — der
 * gleiche, den verbreitete Editoren und Terminal-Emulatoren benutzen. Gemeldet wird es von
 * PaneCrews eigenem Shell-Wrapper (`src-tauri/shell-integration/`), weil zsh
 * und bash das von sich aus nicht tun.
 *
 * Der Rechnername wird mitgegeben, weil er hier eine Bedeutung hat: läuft in
 * der Pane ein `ssh`, meldet womöglich die entfernte Shell — und deren Pfad
 * gegen das LOKALE Dateisystem zu prüfen, beantwortet eine ganz andere Frage.
 */
export function parseOsc7(data: string): ReportedDirectory | null {
  const match = /^file:\/\/([^/]*)(\/.*)$/.exec(data);
  if (!match) return null;
  const host = match[1] ?? "";
  const path = match[2] ?? "";
  try {
    return { host, path: decodeURIComponent(path) };
  } catch {
    // Ein einzelnes rohes `%` im Pfad ist kein Grund, die Meldung ganz zu
    // verwerfen — der Pfad steht ja da.
    return { host, path };
  }
}

/** true/false = geprüft, undefined = Prüfung läuft noch. */
export type DirectoryLookup = (cwd: string, path: string) => boolean | undefined;

export interface DirectoryProbe {
  isDirectory: DirectoryLookup;
  dispose: () => void;
}

// Genug für die Kandidaten eines Prompts, klein genug, dass ein umbenanntes
// Verzeichnis nicht lange falsch beantwortet wird.
const CACHE_LIMIT = 200;

/**
 * Fragt das Backend, ob ein Pfad ein Verzeichnis ist, und merkt sich die
 * Antwort.
 *
 * Synchron abfragbar, obwohl die Antwort asynchron kommt: die Vervollständigung
 * rechnet in einem Animation Frame und kann nicht warten. Ein noch unbekannter
 * Pfad liefert deshalb `undefined` ("noch nicht bestätigt", also nichts
 * anzeigen) und stößt die Prüfung an; `onResolved` fordert danach ein neues
 * Rendern an.
 */
export function createDirectoryProbe(onResolved: () => void): DirectoryProbe {
  const answers = new Map<string, boolean>();
  const pending = new Set<string>();
  let disposed = false;

  return {
    isDirectory: (cwd, path) => {
      const key = `${cwd}\x00${path}`;
      const known = answers.get(key);
      if (known !== undefined) return known;
      if (pending.has(key)) return undefined;

      pending.add(key);
      void invoke<boolean>("path_is_directory", { cwd, path })
        .catch(() => false)
        .then((isDirectory) => {
          pending.delete(key);
          if (disposed) return;
          if (answers.size >= CACHE_LIMIT) {
            // Map iteriert in Einfügereihenfolge — das ist der älteste Eintrag.
            const oldest = answers.keys().next();
            if (!oldest.done) answers.delete(oldest.value);
          }
          answers.set(key, isDirectory);
          onResolved();
        });
      return undefined;
    },
    dispose: () => {
      disposed = true;
    },
  };
}

/** Die Namen, oder undefined solange die Abfrage läuft. */
export type SubdirectoryLookup = (
  cwd: string,
  directory: string,
  prefix: string,
) => readonly string[] | undefined;

export interface SubdirectoryIndex {
  list: SubdirectoryLookup;
  dispose: () => void;
}

/**
 * Fragt das Backend nach den Unterverzeichnissen eines Pfades und merkt sich
 * die Antwort.
 *
 * Dieselbe Bauart wie `createDirectoryProbe` — synchron abfragbar, `undefined`
 * für „läuft noch", `onResolved` fordert danach ein neues Rendern an — und aus
 * demselben Grund: gerechnet wird in einem Animation Frame, der nicht warten
 * kann. Getrennt gehalten statt zusammengelegt, weil die beiden Fragen
 * verschiedene sind: die eine bestätigt einen geratenen Pfad, die andere holt
 * eine Liste, und ihre Antworten dürfen sich keinen Cache-Schlüssel teilen.
 *
 * Gefiltert wird bewusst im Backend statt einmal zu laden und hier zu filtern:
 * die Deckelung auf 50 Einträge ist erst nach dem Filtern eine sinnvolle
 * Grenze — sonst schnitte sie das Gesuchte womöglich schon vorher weg.
 */
export function createSubdirectoryIndex(
  onResolved: () => void,
): SubdirectoryIndex {
  const answers = new Map<string, readonly string[]>();
  const pending = new Set<string>();
  let disposed = false;

  return {
    list: (cwd, directory, prefix) => {
      // Nullbyte als Trenner, nicht Leerzeichen: Verzeichnisnamen dürfen
      // Leerzeichen enthalten, zwei verschiedene Anfragen dürfen also nicht
      // auf denselben Schlüssel fallen.
      const key = [cwd, directory, prefix].join("\u0000");
      const known = answers.get(key);
      if (known !== undefined) return known;
      if (pending.has(key)) return undefined;

      pending.add(key);
      void invoke<string[]>("list_subdirectories", { cwd, directory, prefix })
        .catch(() => [])
        .then((names) => {
          pending.delete(key);
          if (disposed) return;
          if (answers.size >= CACHE_LIMIT) {
            const oldest = answers.keys().next();
            if (!oldest.done) answers.delete(oldest.value);
          }
          answers.set(key, names);
          onResolved();
        });
      return undefined;
    },
    dispose: () => {
      disposed = true;
    },
  };
}
