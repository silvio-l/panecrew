import { useCallback, useEffect, useRef, useState } from "react";
import { buildProject, readDirEntries } from "./loadProject";
import { collectLoadedFolderPaths, withChildrenAt, type Project } from "../types/project";

export interface ProjectsCache {
  /** Aktueller Cache-Stand, absoluter Pfad → `Project`. Reaktiv: ein
   * abgeschlossenes `load`/`refresh` löst für jeden Leser ein Rendering aus —
   * zwei Panes desselben Ordners sehen so denselben, synchron aktualisierten
   * Baum. */
  projects: Readonly<Record<string, Project>>;
  /** Lädt `path`, falls noch nicht im Cache. Gleichzeitige Aufrufe für
   * denselben Pfad (z. B. zwei Panes, die im selben Moment auf denselben
   * Ordner zeigen) teilen sich denselben In-Flight-Request — der Baum wird
   * nicht doppelt gelesen. Liefert das fertige Projekt für Aufrufer, die
   * direkt darauf reagieren müssen (Ordner-Dialog, CLI-Start). */
  load: (path: string) => Promise<Project>;
  /** Baut den Cache-Eintrag für `path` unbedingt neu auf (Wurzel + Git-Deko),
   * z. B. nach einem Speichern oder auf den Refresh-Knopf. Lädt danach auch
   * jeden Ordner neu, der vor dem Refresh schon aufgeklappt war (via
   * `collectLoadedFolderPaths`) — sonst stünde ein sichtbar aufgeklappter
   * Ordner nach dem Refresh plötzlich wieder unbeladen da. */
  refresh: (path: string) => Promise<Project>;
  /** Lädt die Kinder EINES Ordners nach (Lazy-Expand) und merged sie
   * unveränderlich in den gecachten Baum von `path`. Lebt hier und nicht in
   * `ExplorerPanel`, weil dieses Panel bei jedem Projektwechsel neu gemountet
   * wird (eigener `key={project.path}` in `App.tsx`) — ein dort lokaler
   * Zustand würde bei jedem Pane-Wechsel jeden zuvor aufgeklappten Ordner
   * erneut nachladen, genau die Zähigkeit, die die Virtualisierung
   * (2026-08-12) gerade behoben hat. Gleichzeitige Aufrufe für denselben
   * Ordner teilen sich denselben In-Flight-Request, aus demselben Grund wie
   * bei `load`. */
  loadChildren: (path: string, relPath: string) => Promise<void>;
}

/**
 * Pfad-geschlüsselter Projekt-Cache (Ticket 03). Ersetzt das bisherige
 * `buildProject`-Muster, bei dem jede Pane ihren eigenen `Project`-Zustand
 * hielt: mit dem Grid kann derselbe Ordner in mehreren Panes offen sein, und
 * `App.tsx` hält deshalb nur noch pro Pane einen Pfad — die schwere
 * `Project`-Struktur (Baum, Git-Deko) lebt genau einmal pro Pfad hier.
 */
export function useProjects(): ProjectsCache {
  const [projects, setProjects] = useState<Record<string, Project>>({});
  // Gespiegelt in einen Ref, damit `load`/`refresh` unten per `useCallback`
  // referenzstabil bleiben können (leere Dep-Arrays) und trotzdem nie einen
  // veralteten Cache-Stand lesen — sonst würde jeder Konsument, der eine der
  // beiden Funktionen in ein `useEffect`-Dep-Array aufnimmt (z. B. der
  // CLI-Start in App.tsx), bei JEDER Änderung des Caches erneut feuern.
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  // In-Flight-Requests leben außerhalb von React-State: sie sollen den
  // nächsten `load()` für denselben Pfad deduplizieren, aber selbst nie ein
  // Rendering auslösen.
  const inFlightRef = useRef<Map<string, Promise<Project>>>(new Map());
  // Dieselbe Deduplizierung für `loadChildren`, geschlüsselt über Projekt-
  // UND Ordnerpfad — zwei schnelle Klicks auf denselben Chevron (oder ein
  // Klick, während die Sitzungs-Wiederherstellung denselben Ordner bereits
  // nachlädt) teilen sich einen Request statt ihn zu verdoppeln.
  const childrenInFlightRef = useRef<Map<string, Promise<void>>>(new Map());

  const runLoad = useCallback((path: string): Promise<Project> => {
    // Vor dem Neuaufbau gemerkt: welche Ordner waren bereits aufgeklappt
    // beladen? Nur bei `refresh` nicht-leer (bei einem frischen `load` gibt
    // es noch keinen Cache-Eintrag) — nach dem Neulesen der Wurzel werden
    // genau diese Ordner gezielt nachgeladen, sonst stünden sie danach
    // wieder unbeladen da, obwohl sie sichtbar aufgeklappt sind.
    const previouslyLoaded = collectLoadedFolderPaths(
      projectsRef.current[path]?.tree ?? [],
      "",
    );
    const promise = (async () => {
      // Wurzel UND alle vorher aufgeklappten Ordner parallel anfragen
      // (`Promise.all`), nicht die Wurzel zuerst committen und die Ordner
      // danach einzeln in einer `for`-Schleife nachladen: die alte,
      // sequenzielle Fassung rief für jeden zurückkommenden Ordner ein
      // eigenes `setProjects` auf, und `buildProject`s frische Wurzel trägt
      // JEDEN Ordner zunächst als `children: undefined` — ein echter
      // Tauri-IPC-Roundtrip pro Zwischenschritt heißt: ein bereits
      // aufgeklappter Ordner klappte im laufenden Programm sichtbar für
      // einen Render-Zyklus zu und beim nächsten Roundtrip wieder auf,
      // bei mehreren offenen Ebenen entsprechend oft hintereinander (der
      // gemeldete Flacker-Bug). Ein einziges `setProjects` am Ende, erst
      // wenn alles zusammengeführt ist, macht diesen Zwischenzustand
      // strukturell unmöglich statt ihn nur seltener zu machen.
      const [project, reloadedChildren] = await Promise.all([
        buildProject(path),
        Promise.all(
          previouslyLoaded.map(async (relPath) => {
            try {
              return [relPath, await readDirEntries(`${path}/${relPath}`)] as const;
            } catch (error) {
              // Ein Ordner, der zwischen dem alten und dem neuen Baum
              // verschwunden ist (gelöscht, umbenannt), bleibt einfach
              // unbeladen zurück, statt den ganzen Refresh scheitern zu
              // lassen.
              console.error(
                "PaneCrew: Ordner konnte nach Aktualisieren nicht neu geladen werden",
                error,
              );
              return null;
            }
          }),
        ),
      ]);
      let tree = project.tree;
      for (const entry of reloadedChildren) {
        if (entry === null) continue;
        const [relPath, children] = entry;
        tree = withChildrenAt(tree, relPath, children);
      }
      const finalProject = { ...project, tree };
      setProjects((current) => ({ ...current, [path]: finalProject }));
      inFlightRef.current.delete(path);
      return finalProject;
    })();
    inFlightRef.current.set(path, promise);
    return promise;
  }, []);

  const load = useCallback(
    (path: string): Promise<Project> => {
      const cached = projectsRef.current[path];
      if (cached) return Promise.resolve(cached);
      return inFlightRef.current.get(path) ?? runLoad(path);
    },
    [runLoad],
  );

  const loadChildren = useCallback((path: string, relPath: string): Promise<void> => {
    // NUL-Byte statt eines druckbaren Trenners: das käme in echten Pfaden vor
    // und könnte zwei verschiedene (Projekt, Ordner)-Paare auf denselben
    // Schlüssel abbilden.
    const key = path + "\0" + relPath;
    const inFlight = childrenInFlightRef.current.get(key);
    if (inFlight) return inFlight;
    const promise = readDirEntries(`${path}/${relPath}`)
      .then((children) => {
        setProjects((current) => {
          const project = current[path];
          if (!project) return current;
          return { ...current, [path]: { ...project, tree: withChildrenAt(project.tree, relPath, children) } };
        });
      })
      .finally(() => {
        childrenInFlightRef.current.delete(key);
      });
    childrenInFlightRef.current.set(key, promise);
    return promise;
  }, []);

  return { projects, load, refresh: runLoad, loadChildren };
}
