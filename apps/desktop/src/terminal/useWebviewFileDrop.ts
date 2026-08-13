import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { paneIdAtPoint, type PaneRect } from "./dropRouting";

export interface PaneDropRegistration {
  /** Trägt die Pane für Drop-Routing ein — aufgerufen aus `TerminalPane.tsx`
   * per Effekt, jedes Mal wenn `paneId` (neu) mountet. */
  register: (paneId: string, insertPaths: (paths: string[]) => void) => void;
  unregister: (paneId: string) => void;
}

export interface WebviewFileDrop {
  /** Bewusst getrennt von `dragTargetPaneId` und über die Hook-Lebensdauer
   * referenzstabil: `TerminalPane.tsx` nimmt dieses Objekt in das Dep-Array
   * seines Registrierungs-Effekts auf — hinge es mit im selben Objekt wie der
   * sich bei jedem Drag-Wechsel ändernde Zielwert, würde jede Mausbewegung
   * über dem Fenster alle Panes ab- und wieder anmelden. */
  dropTargets: PaneDropRegistration;
  /** Die Pane unter einem gerade schwebenden Datei-Drag, sonst `null` —
   * treibt das Drop-Ziel-HUD (`TerminalPane.tsx`), das dem Zeiger beim
   * Ziehen von Pane zu Pane folgt. */
  dragTargetPaneId: string | null;
}

/**
 * Die EINE Drag-Drop-Registrierung des Grids (Ticket 03): früher registrierte
 * jede Pane ihren eigenen `onDragDropEvent`-Listener (`usePtyTerminal.ts`
 * vor diesem Ticket) — das Event ist aber webview-, nicht pane-weit, ein
 * Drop hätte also in alle gleichzeitig gemounteten Panes geschrieben. Diese
 * eine Instanz prüft stattdessen die Drop-Position gegen die Pane-Rechtecke
 * (`[data-pane-id]`) und liefert nur an die getroffene.
 *
 * `dragDropEnabled` musste in tauri.conf.json NICHT gesetzt werden: die
 * Option ist per Default aktiv (Tauri 2, WebviewOptions.dragDropEnabled —
 * "By default it is enabled"), und genau dieser Default ist der, den wir
 * brauchen. Kehrseite: solange sie aktiv ist, ist DOM-Drag-and-Drop im
 * Webview abgeschaltet — ein HTML5-`drop`-Event läge ohnehin ohne Pfade vor.
 */
export function useWebviewFileDrop(zoom: number): WebviewFileDrop {
  const targetsRef = useRef(new Map<string, (paths: string[]) => void>());
  const [dragTargetPaneId, setDragTargetPaneId] = useState<string | null>(null);
  // Gespiegelt in einen Ref statt als Effekt-Dependency: der Listener selbst
  // bleibt über Zoom-Änderungen hinweg registriert, nur der zum Umrechnen
  // gelesene Faktor ist jeweils aktuell.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const register = useCallback(
    (paneId: string, insertPaths: (paths: string[]) => void) => {
      targetsRef.current.set(paneId, insertPaths);
    },
    [],
  );
  const unregister = useCallback((paneId: string) => {
    targetsRef.current.delete(paneId);
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        // `leave` trägt als einziger Ereignistyp keine Position — er beendet
        // das Drop-Ziel-HUD, mehr gibt es nicht zu tun.
        if (event.payload.type === "leave") {
          setDragTargetPaneId(null);
          return;
        }
        // Physische Gerätepixel → CSS-Logikpixel: erst der Display-
        // Skalierungsfaktor (`toLogical`, Tauris eigene Umrechnung), dann der
        // separate App-Zoom (`useAppZoom.ts`s `webview.setZoom`) — der
        // skaliert den gerenderten Inhalt zusätzlich, unabhängig vom
        // Display-Faktor, und muss deshalb ein zweiter Divisionsschritt sein.
        const logical = event.payload.position.toLogical(
          window.devicePixelRatio,
        );
        const point = {
          x: logical.x / zoomRef.current,
          y: logical.y / zoomRef.current,
        };

        const rects: PaneRect[] = [];
        for (const paneId of targetsRef.current.keys()) {
          const element = document.querySelector(
            `[data-pane-id="${CSS.escape(paneId)}"]`,
          );
          if (!element) continue;
          // Eine versteckte Pane (offener Editor) liefert hier ein
          // Nullrechteck und scheidet über die halboffenen Grenzen in
          // `paneIdAtPoint` von selbst aus — kein Extra-Check nötig.
          rects.push({ paneId, rect: element.getBoundingClientRect() });
        }

        const hit = paneIdAtPoint(rects, point);
        if (event.payload.type === "drop") {
          setDragTargetPaneId(null);
          if (hit === null) return;
          targetsRef.current.get(hit)?.(event.payload.paths);
          return;
        }
        // `enter`/`over`: dieselbe Treffermathe wie der Drop selbst — das
        // HUD zeigt exakt die Pane, in der ein Loslassen JETZT landen würde,
        // keine parallel gepflegte zweite Geometrie. `over` feuert pro
        // Mausbewegung; React lässt identische set-Werte folgenlos verpuffen,
        // gerendert wird nur beim tatsächlichen Pane-Wechsel.
        setDragTargetPaneId(hit);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((error: unknown) => {
        console.error("PaneCrew: Webview-Drag-Drop fehlgeschlagen", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Memoisiert, damit Konsumenten (`TerminalPane.tsx`s Registrierungs-Effekt)
  // sie bedenkenlos in ihr eigenes Dep-Array aufnehmen können, ohne bei jedem
  // Render von `PaneGrid.tsx` neu zu registrieren.
  const dropTargets = useMemo(
    () => ({ register, unregister }),
    [register, unregister],
  );
  return { dropTargets, dragTargetPaneId };
}
