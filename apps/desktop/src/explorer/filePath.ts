/**
 * Letztes Segment eines Dateipfads (POSIX wie Windows).
 *
 * Dieselbe Regel wie `projectNameFromPath` in `types/project.ts`, bewusst
 * nicht von dort importiert: dessen Name macht eine Aussage über ein Projekt,
 * und was hier benannt wird, ist eine Datei.
 *
 * Eigenes Modul, seit ZWEI Flächen dieselbe Datei beim Namen nennen — die
 * Kopfzeile der Editorfläche (`FileEditor.tsx`) und die Rückfrage vor dem
 * Verlassen (`App.tsx` → `UnsavedChangesDialog`). Als Export aus
 * `FileEditor.tsx` hätte es funktioniert, aber eine Komponentendatei, die
 * zusätzlich eine Funktion exportiert, hebelt das Fast Refresh der ganzen
 * Datei aus (`react-refresh/only-export-components`): jede Änderung an der
 * Editorfläche verlöre dann im Dev-Server ihren Zustand statt nur neu zu
 * rendern.
 */
export function fileNameFromPath(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? path;
}

/** True für `path === ancestor` UND für jeden Pfad darunter — die Frage, die
 * eine Explorer-Löschung an jeden anderswo gehaltenen Pfad stellt ("betrifft
 * mich das?"), ob der nun eine einzelne Datei oder ein ganzer Ordner war. */
export function isPathOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** Rechnet `path` über eine Explorer-Umbenennung von `oldPath` nach `newPath`
 * hinweg um — unverändert, falls `path` weder der umbenannte Eintrag selbst
 * noch ein Pfad darunter ist (ein Ordner wurde umbenannt, `path` lag darin).
 * Dieselbe Präfix-Ersetzung, die `fileEditorState.ts`s `renamePath` für den
 * Editor-Puffer vornimmt — hier für jeden anderen Ort, der einen
 * projekt-relativen oder absoluten Pfad hält (Baum-Klappzustand, Datei-
 * Auswahl). */
export function remapRenamedPath(
  path: string,
  oldPath: string,
  newPath: string,
): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
  return path;
}
