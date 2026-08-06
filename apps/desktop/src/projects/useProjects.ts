import { useCallback, useEffect, useRef, useState } from "react";
import { buildProject } from "./loadProject";
import type { Project } from "../types/project";

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
  /** Baut den Cache-Eintrag für `path` unbedingt neu auf (Baum + Git-Deko),
   * z. B. nach einem Speichern oder auf den Refresh-Knopf. */
  refresh: (path: string) => Promise<Project>;
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

  const runLoad = useCallback((path: string): Promise<Project> => {
    const promise = buildProject(path).then((project) => {
      setProjects((current) => ({ ...current, [path]: project }));
      inFlightRef.current.delete(path);
      return project;
    });
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

  return { projects, load, refresh: runLoad };
}
