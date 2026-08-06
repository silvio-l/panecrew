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
